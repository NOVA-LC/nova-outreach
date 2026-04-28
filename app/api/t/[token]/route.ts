// Tracking redirect: /api/t/<token> -> novaintel.io/free-analysis with UTMs.
// Logs the click, then 302s. Designed to be sub-200ms so it doesn't feel slow.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DESTINATION = "https://novaintel.io/free-analysis";

export async function GET(req: NextRequest, ctx: { params: { token: string } }) {
  const token = ctx.params.token;

  const sb = db();
  // Find the send so we can attribute the click.
  const { data: send } = await sb
    .from("sends")
    .select("id, campaign_id")
    .eq("track_token", token)
    .maybeSingle();

  // Fire-and-forget log; don't block the redirect.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const ua = req.headers.get("user-agent") ?? null;
  const ref = req.headers.get("referer") ?? null;

  const url = new URL(DESTINATION);
  url.searchParams.set("utm_source", "cold_email");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", send?.campaign_id ?? "unknown");
  url.searchParams.set("utm_content", token);

  // Best-effort logging (don't await heavy work)
  if (send) {
    sb.from("link_clicks")
      .insert({
        send_id: send.id,
        track_token: token,
        destination: url.toString(),
        ip,
        user_agent: ua,
        referer: ref,
      })
      .then(() => null);
    sb.from("sends")
      .update({
        first_click_at: new Date().toISOString(),
        status: "clicked",
        click_count: 1,
      })
      .eq("id", send.id)
      .is("first_click_at", null) // idempotent first-click
      .then(() => null);
  } else {
    // Unknown token — still log for debugging.
    sb.from("link_clicks")
      .insert({
        send_id: null,
        track_token: token,
        destination: url.toString(),
        ip,
        user_agent: ua,
        referer: ref,
      })
      .then(() => null);
  }

  return NextResponse.redirect(url.toString(), 302);
}
