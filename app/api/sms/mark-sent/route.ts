// Marks an SMS send as sent (Tyler's manual tap). Auth via shared secret.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const u = new URL(req.url);
  if (!env.SCRAPE_SECRET || u.searchParams.get("key") !== env.SCRAPE_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: any = {};
  try { body = await req.json(); } catch {}
  const sendId = body?.send_id;
  const action = body?.action ?? "sent"; // "sent" | "skip"
  if (!sendId) return NextResponse.json({ ok: false, error: "missing_send_id" }, { status: 400 });

  const sb = db();
  if (action === "skip") {
    await sb.from("outreach_sends").update({ status: "failed", error: "manually_skipped" }).eq("id", sendId);
    return NextResponse.json({ ok: true, skipped: true });
  }

  await sb.from("outreach_sends").update({
    status: "sent",
    sent_at: new Date().toISOString(),
  }).eq("id", sendId);

  // Bump the SMS meter.
  const today = new Date().toISOString().slice(0, 10);
  const { data: meter } = await sb.from("outreach_send_meter").select("sent").eq("date", today).eq("channel", "sms").maybeSingle();
  await sb.from("outreach_send_meter").upsert(
    { date: today, channel: "sms", sent: (meter?.sent ?? 0) + 1 },
    { onConflict: "date,channel" },
  );

  return NextResponse.json({ ok: true });
}
