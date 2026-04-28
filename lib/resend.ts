import { Resend } from "resend";
import { env } from "./env";

let _client: Resend | null = null;
export function resend(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubUrl: string;
  campaignId: string;
  trackToken: string;
}

// Returns Resend message id on success, or throws.
export async function sendOne(args: SendArgs): Promise<string> {
  const r = resend();
  const result = await r.emails.send({
    from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: env.REPLY_TO,
    headers: {
      // Gmail/Apple/Outlook will surface a one-click unsubscribe in the inbox UI.
      // CRITICAL for not getting marked spam at scale.
      "List-Unsubscribe": `<${args.unsubUrl}>, <mailto:${env.REPLY_TO}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      // Tag for analytics
      "X-Campaign-Id": args.campaignId,
      "X-Track-Token": args.trackToken,
    },
    tags: [
      { name: "campaign", value: args.campaignId.slice(0, 8) },
      { name: "track", value: args.trackToken },
    ],
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Resend returned no message id");
  return result.data.id;
}
