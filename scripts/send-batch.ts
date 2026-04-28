#!/usr/bin/env tsx
/**
 * CLI version of /api/cron/send-batch — runnable from GitHub Actions or locally.
 *
 * Usage:
 *   tsx scripts/send-batch.ts            # send up to PER_RUN_CAP from active campaign
 *   tsx scripts/send-batch.ts --dry      # render but don't send
 *   tsx scripts/send-batch.ts --limit 5  # override per-run cap
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 * APP_URL, FROM_EMAIL, FROM_NAME, REPLY_TO, COMPLIANCE_ADDRESS, DAILY_SEND_CAP, PER_RUN_CAP
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { renderHtml, renderText } from "../lib/email/render";
import { pickSubject } from "../lib/email/subjects";
import { verifyEmail } from "../lib/email/verify";

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
const DAILY_SEND_CAP = parseInt(process.env.DAILY_SEND_CAP ?? "100", 10);
let PER_RUN_CAP = parseInt(process.env.PER_RUN_CAP ?? "6", 10);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitFlagIdx = args.indexOf("--limit");
if (limitFlagIdx !== -1) PER_RUN_CAP = parseInt(args[limitFlagIdx + 1] ?? "6", 10);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: "outreach" },
});
const resend = new Resend(RESEND_API_KEY);

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: meterRow } = await sb
    .from("send_meter")
    .select("sent")
    .eq("date", today)
    .eq("channel", "email")
    .maybeSingle();
  const sentToday = meterRow?.sent ?? 0;
  const remainingToday = DAILY_SEND_CAP - sentToday;
  if (remainingToday <= 0) {
    console.log(`Daily cap hit (${sentToday}/${DAILY_SEND_CAP}). Exiting.`);
    return;
  }
  const batchSize = Math.min(PER_RUN_CAP, remainingToday);

  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("active", true)
    .eq("channel", "email")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campaign) {
    console.error("No active email campaign. Insert one in outreach.campaigns.");
    process.exit(1);
  }

  // Eligible candidates
  const { data: agents } = await sb
    .from("agents")
    .select("id, email, first_name, brokerage, state")
    .eq("excluded", false)
    .is("unsubscribed_at", null)
    .is("hard_bounced_at", null)
    .is("complained_at", null)
    .limit(batchSize * 5);
  if (!agents || agents.length === 0) {
    console.log("No eligible agents.");
    return;
  }

  const { data: alreadySent } = await sb
    .from("sends")
    .select("agent_id")
    .eq("campaign_id", campaign.id)
    .in("agent_id", agents.map((a) => a.id));
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.agent_id));

  const emails = agents.map((a) => a.email.toLowerCase().trim());
  const { data: supps } = await sb
    .from("suppressions")
    .select("email_normalized")
    .in("email_normalized", emails);
  const suppSet = new Set((supps ?? []).map((s: any) => s.email_normalized));

  const candidates = agents
    .filter((a: any) => !sentSet.has(a.id) && !suppSet.has(a.email.toLowerCase().trim()))
    .slice(0, batchSize);

  console.log(`Candidates: ${candidates.length} / batch size ${batchSize}`);

  let sent = 0;
  for (const agent of candidates) {
    const v = await verifyEmail(agent.email);
    if (!v.ok) {
      console.log(`SKIP ${agent.email}: verify_failed:${v.reason}`);
      await sb.from("agents").update({ excluded: true, excluded_reason: `invalid_email_${v.reason}` }).eq("id", agent.id);
      continue;
    }

    const { data: sendRow, error: insErr } = await sb
      .from("sends")
      .insert({ agent_id: agent.id, campaign_id: campaign.id, channel: "email", status: "queued" })
      .select("id, track_token")
      .single();
    if (insErr || !sendRow) {
      console.error(`Insert failed for ${agent.email}: ${insErr?.message}`);
      continue;
    }

    const trackUrl = `${APP_URL}/api/t/${sendRow.track_token}`;
    const unsubUrl = `${APP_URL}/api/u/${sendRow.track_token}`;
    const html = renderHtml({ firstName: agent.first_name, brokerage: agent.brokerage, state: agent.state, trackUrl, unsubUrl });
    const text = renderText({ firstName: agent.first_name, brokerage: agent.brokerage, state: agent.state, trackUrl, unsubUrl });
    const subject = pickSubject(sendRow.id);

    if (DRY) {
      console.log(`[DRY] ${agent.email} :: ${subject}\n${text}\n---`);
      await sb.from("sends").update({ status: "failed", error: "dry_run" }).eq("id", sendRow.id);
      continue;
    }

    try {
      const result = await resend.emails.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [agent.email],
        subject,
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
        ],
      });
      if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error));
      const messageId = result.data?.id;
      await sb.from("sends").update({
        provider_message_id: messageId, status: "sent", sent_at: new Date().toISOString(),
      }).eq("id", sendRow.id);
      console.log(`SENT ${agent.email} (${messageId})`);
      sent++;
    } catch (e: any) {
      console.error(`FAIL ${agent.email}: ${e.message}`);
      await sb.from("sends").update({ status: "failed", error: e.message }).eq("id", sendRow.id);
    }
  }

  if (sent > 0 && !DRY) {
    await sb.from("send_meter").upsert(
      { date: today, channel: "email", sent: sentToday + sent },
      { onConflict: "date,channel" },
    );
  }
  console.log(`Sent ${sent}. Today total: ${sentToday + sent}/${DAILY_SEND_CAP}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
