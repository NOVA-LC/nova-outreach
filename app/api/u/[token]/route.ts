// Unsubscribe handler. Supports both GET (link in email) and POST (Gmail one-click).
// Adds to suppressions, marks agent unsubscribed_at, marks send unsubscribed.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function unsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
  const sb = db();
  const { data: send } = await sb
    .from("sends")
    .select("id, agent_id, agents:agent_id(email, email_normalized)")
    .eq("track_token", token)
    .maybeSingle();

  if (!send || !send.agent_id) return { ok: false };
  const email = (send as any).agents?.email_normalized;
  const now = new Date().toISOString();

  await Promise.all([
    sb.from("agents").update({ unsubscribed_at: now }).eq("id", send.agent_id),
    sb.from("sends").update({ unsubscribed_at: now, status: "unsubscribed" }).eq("id", send.id),
    email
      ? sb
          .from("suppressions")
          .upsert(
            { email_normalized: email, reason: "unsubscribe", source_send_id: send.id },
            { onConflict: "email_normalized" },
          )
      : Promise.resolve(),
  ]);

  return { ok: true, email: (send as any).agents?.email };
}

export async function GET(_req: NextRequest, ctx: { params: { token: string } }) {
  const r = await unsubscribe(ctx.params.token);
  if (!r.ok) {
    return new NextResponse("This unsubscribe link is no longer valid.", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
  }
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:48px auto;padding:24px;color:#111;line-height:1.6;">
  <h2 style="margin-bottom:8px;">You're unsubscribed.</h2>
  <p>${r.email ?? "Your email"} won't receive future messages from us. Sorry to bother.</p>
  <p style="color:#666;font-size:14px;">— Tyler</p>
</body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html" } });
}

// Gmail List-Unsubscribe-Post hits this with a form POST.
export async function POST(_req: NextRequest, ctx: { params: { token: string } }) {
  await unsubscribe(ctx.params.token);
  return new NextResponse("ok", { status: 200 });
}
