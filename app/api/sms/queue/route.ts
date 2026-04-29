// Returns the next N agents to text. Auth via shared secret in ?key=
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { renderSms } from "@/lib/sms/render";

export const dynamic = "force-dynamic";

function authorize(req: NextRequest): boolean {
  const u = new URL(req.url);
  const k = u.searchParams.get("key");
  return !!env.SCRAPE_SECRET && k === env.SCRAPE_SECRET;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const sb = db();

  // Active SMS campaign (created by bootstrap script).
  const { data: campaign } = await sb
    .from("outreach_campaigns")
    .select("*")
    .eq("active", true)
    .eq("channel", "sms")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ ok: false, error: "no_active_sms_campaign" }, { status: 404 });
  }

  const url = new URL(req.url);
  const take = Math.min(parseInt(url.searchParams.get("take") ?? "10", 10), 50);

  // Eligible agents: not excluded, has phone, not already sent this campaign.
  const { data: agents, error } = await sb
    .from("outreach_agents")
    .select("id, first_name, full_name, brokerage, state, phone, phone_normalized")
    .eq("excluded", false)
    .is("unsubscribed_at", null)
    .not("phone_normalized", "is", null)
    .limit(take * 5); // overshoot

  if (error || !agents) return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });

  const { data: alreadySent } = await sb
    .from("outreach_sends")
    .select("agent_id")
    .eq("campaign_id", campaign.id)
    .eq("channel", "sms")
    .in("agent_id", agents.map((a) => a.id));
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.agent_id));

  const next = agents.filter((a: any) => !sentSet.has(a.id)).slice(0, take);

  // Pre-create send rows so we can track tokens; Tyler taps "sent" and we mark them.
  const queue = [];
  for (const a of next) {
    const { data: sendRow } = await sb
      .from("outreach_sends")
      .insert({
        agent_id: a.id,
        campaign_id: campaign.id,
        channel: "sms",
        status: "queued",
      })
      .select("id, track_token")
      .single();
    if (!sendRow) continue;

    const trackUrl = `${env.APP_URL}/api/t/${sendRow.track_token}`;
    const body = renderSms({
      firstName: a.first_name,
      brokerage: a.brokerage,
      trackUrl,
    });

    queue.push({
      send_id: sendRow.id,
      track_token: sendRow.track_token,
      first_name: a.first_name,
      full_name: a.full_name,
      brokerage: a.brokerage,
      state: a.state,
      phone: a.phone_normalized,
      body,
    });
  }

  return NextResponse.json({ ok: true, queue, campaign_id: campaign.id });
}
