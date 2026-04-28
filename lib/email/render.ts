// Renders the cold email body (HTML + plain text) per recipient.
// Style choice: short, conversational, single CTA. NOT newsletter-y.
// Personalization: first name (if known), brokerage (if known).

import { env } from "../env";

export interface RenderArgs {
  firstName?: string | null;
  brokerage?: string | null;
  state?: string | null;
  trackUrl: string;       // e.g. https://app/t/<token>
  unsubUrl: string;       // e.g. https://app/u/<token>
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstSentence(args: RenderArgs): string {
  const name = (args.firstName ?? "").trim();
  if (name) return `Hey ${name},`;
  return "Hey,";
}

function specificDetail(args: RenderArgs): string {
  if (args.brokerage && /[A-Za-z]/.test(args.brokerage)) {
    return ` saw you're with ${args.brokerage}.`;
  }
  if (args.state) return ` saw you're licensed in ${args.state}.`;
  return "";
}

export function renderText(args: RenderArgs): string {
  const opener = firstSentence(args);
  const detail = specificDetail(args);

  return [
    `${opener} I built a thing that grades your last life-insurance call in about 60 seconds —`,
    `gives you a letter grade, finds the 3 mistakes that cost you the policy, and rewrites the`,
    `exact lines you should have said instead.${detail}`,
    ``,
    `First analysis is free, no signup. If you want it on every call after that it's $20/mo.`,
    ``,
    `Try one of yours:`,
    `${args.trackUrl}`,
    ``,
    `— Tyler`,
    ``,
    `---`,
    `Sent to a licensed life insurance agent. If this isn't you or you don't want these:`,
    `${args.unsubUrl}`,
    `${env.COMPLIANCE_ADDRESS}`,
  ].join("\n");
}

export function renderHtml(args: RenderArgs): string {
  const opener = escape(firstSentence(args));
  const detail = escape(specificDetail(args));
  const url = escape(args.trackUrl);
  const unsub = escape(args.unsubUrl);
  const addr = escape(env.COMPLIANCE_ADDRESS);

  // Plain styling, no images, no tables. Highest deliverability.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.55;font-size:16px;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <p>${opener}</p>
    <p>I built a thing that grades your last life-insurance call in about 60 seconds — gives you a letter grade, finds the 3 mistakes that cost you the policy, and rewrites the exact lines you should have said instead.${detail}</p>
    <p>First analysis is free, no signup. If you want it on every call after that it's $20/mo.</p>
    <p>Try one of yours:<br>
       <a href="${url}" style="color:#1d4ed8;">${url}</a></p>
    <p>&mdash; Tyler</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
    <p style="font-size:12px;color:#666;">
      Sent to a licensed life insurance agent. Not relevant?
      <a href="${unsub}" style="color:#666;">Unsubscribe</a>.<br>
      ${addr}
    </p>
  </div>
</body></html>`;
}
