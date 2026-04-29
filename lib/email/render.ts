// Renders the cold email body — story-driven variants picked stably per send.
import { env } from "../env";
import { pickVariant } from "./variants";

export interface RenderArgs {
  firstName?: string | null;
  brokerage?: string | null;
  state?: string | null;
  trackUrl: string;
  unsubUrl: string;
  variantSeed: string;   // send_id — stable per recipient
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderSubject(seed: string): string {
  return pickVariant(seed).subject;
}

export function renderText(args: RenderArgs): string {
  const v = pickVariant(args.variantSeed);
  const body = v.text({ firstName: args.firstName ?? "", trackUrl: args.trackUrl });
  return `${body}

---
Sent to a licensed life insurance agent. Not relevant? ${args.unsubUrl}
${env.COMPLIANCE_ADDRESS}`;
}

export function renderHtml(args: RenderArgs): string {
  const v = pickVariant(args.variantSeed);
  const body = v.html({ firstName: args.firstName ?? "", trackUrl: args.trackUrl });
  const unsub = escape(args.unsubUrl);
  const addr = escape(env.COMPLIANCE_ADDRESS);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.55;font-size:16px;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    ${body}
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
    <p style="font-size:12px;color:#666;">
      Sent to a licensed life insurance agent. Not relevant?
      <a href="${unsub}" style="color:#666;">Unsubscribe</a>.<br>
      ${addr}
    </p>
  </div>
</body></html>`;
}
