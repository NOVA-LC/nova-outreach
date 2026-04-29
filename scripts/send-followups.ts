#!/usr/bin/env tsx
/**
 * Follow-up runner. For each campaign with followups_enabled = true, finds
 * sends that:
 *   - have status sent/delivered/opened (not bounced/complained/failed)
 *   - have NOT been clicked (first_click_at IS NULL)
 *   - have NOT been unsubscribed
 *   - whose recipient hasn't already received the next-step follow-up
 *   - are old enough per the campaign's followup_intervals_days[step_index]
 *   - are within campaign.max_followup_steps
 *
 * Inserts a new outreach_sends row with step_index = parent.step_index + 1,
 * parent_send_id = parent.id, then sends via Resend. Shares the daily cap
 * meter with initial sends.
 *
 * Usage:
 *   tsx scripts/send-followups.ts            # run; respects PER_RUN_CAP
 *   tsx scripts/send-followups.ts --dry      # render only, don't send
 *   tsx scripts/send-followups.ts --limit 5  # override per-run cap
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 * APP_URL, FROM_EMAIL, FROM_NAME, REPLY_TO, COMPLIANCE_ADDRESS, DAILY_SEND_CAP.
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { pickFollowup, maxFollowupSteps } from "../lib/email/followups";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = envOrDie("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = envOrDie("RESEND_API_KEY");
const APP_URL = envOrDie("APP_URL");
const FROM_EMAIL = envOrDie("FROM_EMAIL");
const FROM_NAME = process.env.FROM_NAME ?? "Tyler";
const REPLY_TO = process.env.REPLY_TO ?? FROM_EMAIL;
const COMPLIANCE_ADDRESS = process.env.COMPLIANCE_ADDRESS ?? "Nova Intel, Atlanta, GA";
const DAILY_SEND_CAP = parseInt(process.env.DAILY_SEND_CAP ?? "100", 10);
let PER_RUN_CAP = parseInt(process.env.PER_RUN_CAP ?? "10", 10);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitFlagIdx = args.indexOf("--limit");
if (limitFlagIdx !== -1) PER_RUN_CAP = parseInt(args[limitFlagIdx + 1] ?? "10", 10);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const resend = new Resend(RESEND_API_KEY);

interface CandidateRow {
  id: string;                    // parent send id
  agent_id: string;
  campaign_id: string;
  step_index: number;
  sent_at: string;
}

interface CampaignRow {
  id: string;
  active: boolean;
  followups_enabled: boolean;
  followup_intervals_days: number[];
  max_followup_steps: number;
}

interface AgentRow {
  id: string;
  email: string;
  first_name: string | null;
  brokerage: string | null;
  state: string | null;
  unsubscribed_at: string | null;
  hard_bounced_at: string | null;
  complained_at: string | null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Daily-cap budget shared with initial sends.
  const { data: meterRow } = await sb
    .from("outreach_send_meter")
    .select("sent")
    .eq("date", today)
    .eq("channel", "email")
    .maybeSingle();
  const sentToday = meterRow?.sent ?? 0;
  const remainingToday = DAILY_SEND_CAP - sentToday;
  if (remainingToday <= 0) {
    console.log(`Daily cap hit (${sentToday}/${DAILY_SEND_CAP}). Skipping followups.`);
    return;
  }
  const batchSize = Math.min(PER_RUN_CAP, remainingToday);

  // Active campaigns with follow-ups enabled.
  const { data: campaigns, error: campErr } = await sb
    .from("outreach_campaigns")
    .select("id, active, followups_enabled, followup_intervals_days, max_followup_steps")
    .eq("active", true)
    .eq("followups_enabled", true);
  if (campErr) { console.error(`campaign load: ${campErr.message}`); process.exit(1); }
  if (!campaigns || campaigns.length === 0) {
    console.log("No active campaigns with followups_enabled. Done.");
    return;
  }

  let sent = 0;
  for (const campaign of campaigns as CampaignRow[]) {
    if (sent >= batchSize) break;
    const intervals = campaign.followup_intervals_days ?? [4, 11];
    const maxSteps = Math.min(campaign.max_followup_steps ?? 2, maxFollowupSteps());

    // For each step (1..maxSteps), find candidates whose parent send is old
    // enough and who haven't already received this step.
    for (let nextStep = 1; nextStep <= maxSteps; nextStep++) {
      if (sent >= batchSize) break;
      const intervalDays = intervals[nextStep - 1] ?? intervals[intervals.length - 1] ?? 7;
      const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000).toISOString();

      // Parents at step (nextStep - 1) ready for this step.
      const parentStep = nextStep - 1;
      const { data: parents, error: parErr } = await sb
        .from("outreach_sends")
        .select("id, agent_id, campaign_id, step_index, sent_at")
        .eq("campaign_id", campaign.id)
        .eq("channel", "email")
        .eq("step_index", parentStep)
        .in("status", ["sent", "delivered", "opened"])
        .is("first_click_at", null)
        .is("unsubscribed_at", null)
        .lte("sent_at", cutoff)
        .order("sent_at", { ascending: true })
        .limit(batchSize * 5);
      if (parErr) {
        console.warn(`load parents step=${nextStep}: ${parErr.message}`);
        continue;
      }
      if (!parents || parents.length === 0) {
        console.log(`step ${nextStep}: no candidates (interval=${intervalDays}d)`);
        continue;
      }

      // Drop parents whose agent already received this step (or higher).
      const agentIds = parents.map((p: any) => p.agent_id);
      const { data: existingSteps } = await sb
        .from("outreach_sends")
        .select("agent_id, step_index")
        .eq("campaign_id", campaign.id)
        .eq("channel", "email")
        .gte("step_index", nextStep)
        .in("agent_id", agentIds);
      const alreadyAtStep = new Set((existingSteps ?? []).map((r: any) => r.agent_id));

      // Drop suppressed / bounced / complained / unsub agents.
      const fresh = (parents as CandidateRow[]).filter((p) => !alreadyAtStep.has(p.agent_id));
      if (fresh.length === 0) continue;

      const { data: agents, error: agErr } = await sb
        .from("outreach_agents")
        .select("id, email, first_name, brokerage, state, unsubscribed_at, hard_bounced_at, complained_at")
        .in("id", fresh.map((p) => p.agent_id));
      if (agErr) { console.warn(`load agents: ${agErr.message}`); continue; }
      const agentMap = new Map<string, AgentRow>();
      for (const a of agents ?? []) agentMap.set(a.id, a as AgentRow);

      const emails = (agents ?? []).map((a: any) => (a.email ?? "").toLowerCase().trim());
      const { data: supps } = await sb
        .from("outreach_suppressions")
        .select("email_normalized")
        .in("email_normalized", emails);
      const suppSet = new Set((supps ?? []).map((s: any) => s.email_normalized));

      for (const parent of fresh) {
        if (sent >= batchSize) break;
        const agent = agentMap.get(parent.agent_id);
        if (!agent) continue;
        if (agent.unsubscribed_at || agent.hard_bounced_at || agent.complained_at) continue;
        const emailKey = (agent.email ?? "").toLowerCase().trim();
        if (suppSet.has(emailKey)) continue;
        if (emailKey.endsWith("@noemail.local")) continue; // synthetic phone-only

        const variant = pickFollowup(nextStep);
        if (!variant) continue;

        const { data: sendRow, error: insErr } = await sb
          .from("outreach_sends")
          .insert({
            agent_id: agent.id,
            campaign_id: campaign.id,
            channel: "email",
            status: "queued",
            step_index: nextStep,
            parent_send_id: parent.id,
          })
          .select("id, track_token")
          .single();
        if (insErr || !sendRow) { console.error(`insert send: ${insErr?.message}`); continue; }

        const trackUrl = `${APP_URL}/api/t/${sendRow.track_token}`;
        const unsubUrl = `${APP_URL}/api/u/${sendRow.track_token}`;
        const fname = (agent.first_name ?? "").trim();
        const text = `${variant.text({ firstName: fname, trackUrl })}\n\n---\nNot relevant? ${unsubUrl}\n${COMPLIANCE_ADDRESS}`;
        const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;line-height:1.55;font-size:16px;">
<div style="max-width:560px;margin:0 auto;padding:24px;">
${variant.html({ firstName: fname, trackUrl })}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#666;">
Sent to a licensed life insurance agent. Not relevant?
<a href="${unsubUrl}" style="color:#666;">Unsubscribe</a>.<br>
${COMPLIANCE_ADDRESS}
</p>
</div></body></html>`;

        if (DRY) {
          console.log(`[DRY] step=${nextStep} ${agent.email} :: ${variant.subject}`);
          await sb.from("outreach_sends").update({ status: "failed", error: "dry_run" }).eq("id", sendRow.id);
          continue;
        }

        try {
          const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: [agent.email],
            subject: variant.subject,
            html,
            text,
            replyTo: REPLY_TO,
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>, <mailto:${REPLY_TO}?subject=unsubscribe>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            tags: [
              { name: "campaign", value: campaign.id.slice(0, 8) },
              { name: "track", value: sendRow.track_token },
              { name: "step", value: String(nextStep) },
            ],
          });
          if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error));
          const messageId = result.data?.id;
          await sb.from("outreach_sends").update({
            provider_message_id: messageId,
            status: "sent",
            sent_at: new Date().toISOString(),
          }).eq("id", sendRow.id);
          console.log(`SENT step=${nextStep} ${agent.email} (${messageId})`);
          sent++;
        } catch (e: any) {
          console.error(`FAIL step=${nextStep} ${agent.email}: ${e.message}`);
          await sb.from("outreach_sends").update({ status: "failed", error: e.message }).eq("id", sendRow.id);
        }
      }
    }
  }

  if (sent > 0 && !DRY) {
    await sb.from("outreach_send_meter").upsert(
      { date: today, channel: "email", sent: sentToday + sent },
      { onConflict: "date,channel" },
    );
  }
  console.log(`Followups sent: ${sent}. Day total: ${sentToday + sent}/${DAILY_SEND_CAP}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
