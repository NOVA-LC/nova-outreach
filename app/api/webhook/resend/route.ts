// Resend webhook handler. Receives delivery/open/click/bounce/complaint events.
// We mirror them onto the `sends` row and append to `email_events` for audit.
//
// Resend signs webhooks with svix. We optionally verify (recommended). For brevity,
// signature verification is sketched — fill RESEND_WEBHOOK_SECRET in env to enable.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifySvix(req: NextRequest, raw: string): Promise<boolean> {
  if (!env.RESEND_WEBHOOK_SECRET) return true; // skip verification if not configured
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;

  const secret = env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "");
  const key = Buffer.from(secret, "base64");
  const signed = `${id}.${ts}.${raw}`;
  // HMAC-SHA256 via Web Crypto (works on Edge/Node)
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(signed));
  const computed = "v1," + Buffer.from(sigBuf).toString("base64");
  // svix-signature header may have multiple sigs space-separated, pick any match
  return sig.split(" ").some((s) => timingEqual(s, computed));
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!(await verifySvix(req, raw))) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const eventType: string = payload?.type ?? payload?.event ?? "unknown";
  const data = payload?.data ?? {};
  const messageId: string | undefined = data?.email_id ?? data?.id;
  const occurredAt: string = data?.created_at ?? new Date().toISOString();

  const sb = db();

  // Find the send row by provider_message_id.
  let sendId: string | null = null;
  if (messageId) {
    const { data: s } = await sb.from("sends").select("id").eq("provider_message_id", messageId).maybeSingle();
    sendId = s?.id ?? null;
  }

  // Always log the raw event.
  await sb.from("email_events").insert({
    send_id: sendId,
    provider_message_id: messageId,
    event_type: eventType,
    occurred_at: occurredAt,
    payload,
  });

  if (!sendId) {
    return NextResponse.json({ ok: true, note: "no_matching_send" });
  }

  // Mirror state onto the send row.
  const updates: Record<string, any> = {};
  switch (eventType) {
    case "email.delivered":
      updates.delivered_at = occurredAt;
      updates.status = "delivered";
      break;
    case "email.opened":
      updates.first_open_at = occurredAt;
      updates.open_count = (await getCount(sb, sendId, "open_count")) + 1;
      if (await isStatusBefore(sb, sendId, "opened")) updates.status = "opened";
      break;
    case "email.clicked":
      updates.first_click_at = occurredAt;
      updates.click_count = (await getCount(sb, sendId, "click_count")) + 1;
      updates.status = "clicked";
      break;
    case "email.bounced":
      updates.bounced_at = occurredAt;
      updates.status = "bounced";
      // Record on agent + suppress.
      await markBounce(sb, sendId);
      break;
    case "email.complained":
      updates.complained_at = occurredAt;
      updates.status = "complained";
      await markComplaint(sb, sendId);
      break;
    case "email.delivery_delayed":
      // Don't change status; just note.
      break;
    default:
      break;
  }
  if (Object.keys(updates).length > 0) {
    await sb.from("sends").update(updates).eq("id", sendId);
  }

  return NextResponse.json({ ok: true });
}

async function getCount(sb: ReturnType<typeof db>, sendId: string, col: string): Promise<number> {
  const { data } = await sb.from("sends").select(col).eq("id", sendId).maybeSingle();
  return ((data as any)?.[col] as number) ?? 0;
}

async function isStatusBefore(sb: ReturnType<typeof db>, sendId: string, target: string): Promise<boolean> {
  const order = ["queued", "sent", "delivered", "opened", "clicked", "bounced", "complained", "failed", "unsubscribed"];
  const { data } = await sb.from("sends").select("status").eq("id", sendId).maybeSingle();
  const cur = data?.status ?? "queued";
  return order.indexOf(cur) < order.indexOf(target);
}

async function markBounce(sb: ReturnType<typeof db>, sendId: string) {
  const { data: s } = await sb
    .from("sends")
    .select("agent_id, agents:agent_id(email_normalized)")
    .eq("id", sendId)
    .maybeSingle();
  if (!s) return;
  const email = (s as any).agents?.email_normalized;
  if (s.agent_id) {
    await sb.from("agents").update({ hard_bounced_at: new Date().toISOString() }).eq("id", s.agent_id);
  }
  if (email) {
    await sb.from("suppressions").upsert(
      { email_normalized: email, reason: "hard_bounce", source_send_id: sendId },
      { onConflict: "email_normalized" },
    );
  }
}

async function markComplaint(sb: ReturnType<typeof db>, sendId: string) {
  const { data: s } = await sb
    .from("sends")
    .select("agent_id, agents:agent_id(email_normalized)")
    .eq("id", sendId)
    .maybeSingle();
  if (!s) return;
  const email = (s as any).agents?.email_normalized;
  if (s.agent_id) {
    await sb.from("agents").update({ complained_at: new Date().toISOString() }).eq("id", s.agent_id);
  }
  if (email) {
    await sb.from("suppressions").upsert(
      { email_normalized: email, reason: "complaint", source_send_id: sendId },
      { onConflict: "email_normalized" },
    );
  }
}
