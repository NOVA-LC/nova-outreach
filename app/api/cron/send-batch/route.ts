// Vercel Cron-triggered. Pulls N un-emailed agents (excluding suppressions, AIL/Globe,
// already-sent), sends each via Resend, records the send. Never exceeds DAILY_SEND_CAP.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendOne } from "@/lib/resend";
import { renderHtml, renderText } from "@/lib/email/render";
import { pickSubject } from "@/lib/email/subjects";
import { verifyEmail } from "@/lib/email/verify";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: NextRequest): boolean {
  // Vercel cron sends "Authorization: Bearer $CRON_SECRET"
  const a = req.headers.get("authorization") ?? "";
  return a === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = db();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Check today's send count.
  const { data: meterRow } = await sb
    .from("send_meter")
    .select("sent")
    .eq("date", today)
    .eq("channel", "email")
    .maybeSingle();

  const sentToday = meterRow?.sent ?? 0;
  const remainingToday = env.DAILY_SEND_CAP - sentToday;
  if (remainingToday <= 0) {
    return NextResponse.json({ ok: true, skipped: "daily_cap_hit", sentToday });
  }

  const batchSize = Math.min(env.PER_RUN_CAP, remainingToday);

  // 2. Pick the active campaign.
  const { data: campaign, error: campErr } = await sb
    .from("campaigns")
    .select("*")
    .eq("active", true)
    .eq("channel", "email")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campErr || !campaign) {
    return NextResponse.json(
      { ok: false, error: "no_active_campaign", detail: campErr?.message },
      { status: 500 },
    );
  }

  // 3. Pick N agents who: are not excluded, not unsubscribed, not bounced,
  //    not suppressed, and don't already have a send for this campaign.
  //    Done via SQL because the negative-existence filter is awkward in PostgREST.
  const { data: candidates, error: candErr } = await sb.rpc("pick_unsent_agents", {
    p_campaign_id: campaign.id,
    p_limit: batchSize,
  });
  if (candErr) {
    // Fallback if the RPC isn't installed yet: do it client-side with two queries.
    const { data: agents, error: e1 } = await sb
      .from("agents")
      .select("id, email, first_name, brokerage, state")
      .eq("excluded", false)
      .is("unsubscribed_at", null)
      .is("hard_bounced_at", null)
      .is("complained_at", null)
      .limit(batchSize * 5); // overshoot, filter in next step
    if (e1 || !agents) {
      return NextResponse.json({ ok: false, error: "agent_query_failed", detail: e1?.message }, { status: 500 });
    }
    const { data: alreadySent } = await sb
      .from("sends")
      .select("agent_id")
      .eq("campaign_id", campaign.id)
      .in("agent_id", agents.map((a) => a.id));
    const sentSet = new Set((alreadySent ?? []).map((r: any) => r.agent_id));

    // Suppression check
    const emails = agents.map((a) => a.email.toLowerCase().trim());
    const { data: supps } = await sb
      .from("suppressions")
      .select("email_normalized")
      .in("email_normalized", emails);
    const suppSet = new Set((supps ?? []).map((s: any) => s.email_normalized));

    const filtered = agents
      .filter((a: any) => !sentSet.has(a.id) && !suppSet.has(a.email.toLowerCase().trim()))
      .slice(0, batchSize);

    return await sendBatch(sb, campaign, filtered, today, sentToday);
  }
  return await sendBatch(sb, campaign, candidates ?? [], today, sentToday);
}

async function sendBatch(
  sb: ReturnType<typeof db>,
  campaign: any,
  candidates: any[],
  today: string,
  sentToday: number,
) {
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "no_candidates", sentToday });
  }

  let sent = 0;
  const errors: { email: string; err: string }[] = [];

  for (const agent of candidates) {
    // 0. LAST-CHANCE EMAIL VERIFICATION. Belt-and-suspenders — even if the
    //    agent was imported with verification, the MX cache TTL is 24h and
    //    domains can change. Re-verify before send.
    const v = await verifyEmail(agent.email);
    if (!v.ok) {
      // Mark agent excluded and skip. Don't even create a send row.
      await sb
        .from("agents")
        .update({ excluded: true, excluded_reason: `invalid_email_${v.reason}` as any })
        .eq("id", agent.id);
      errors.push({ email: agent.email, err: `verify_failed:${v.reason}` });
      continue;
    }

    // 1. Insert send row first (claims the slot, gets us a track_token).
    const { data: sendRow, error: insertErr } = await sb
      .from("sends")
      .insert({
        agent_id: agent.id,
        campaign_id: campaign.id,
        channel: "email",
        status: "queued",
      })
      .select("id, track_token")
      .single();

    if (insertErr || !sendRow) {
      errors.push({ email: agent.email, err: insertErr?.message ?? "insert failed" });
      continue;
    }

    const trackUrl = `${env.APP_URL}/api/t/${sendRow.track_token}`;
    const unsubUrl = `${env.APP_URL}/api/u/${sendRow.track_token}`;

    const html = renderHtml({
      firstName: agent.first_name,
      brokerage: agent.brokerage,
      state: agent.state,
      trackUrl,
      unsubUrl,
    });
    const text = renderText({
      firstName: agent.first_name,
      brokerage: agent.brokerage,
      state: agent.state,
      trackUrl,
      unsubUrl,
    });
    const subject = pickSubject(sendRow.id);

    try {
      const messageId = await sendOne({
        to: agent.email,
        subject,
        html,
        text,
        unsubUrl,
        campaignId: campaign.id,
        trackToken: sendRow.track_token,
      });
      await sb
        .from("sends")
        .update({
          provider_message_id: messageId,
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", sendRow.id);
      sent++;
    } catch (e: any) {
      await sb
        .from("sends")
        .update({ status: "failed", error: e?.message ?? String(e) })
        .eq("id", sendRow.id);
      errors.push({ email: agent.email, err: e?.message ?? String(e) });
    }
  }

  // Bump meter (upsert).
  if (sent > 0) {
    await sb.from("send_meter").upsert(
      { date: today, channel: "email", sent: sentToday + sent },
      { onConflict: "date,channel" },
    );
  }

  return NextResponse.json({ ok: true, sent, errors, sentToday: sentToday + sent });
}
