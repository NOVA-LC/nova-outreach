// Personalized SMS body. <= 160 chars when possible (multi-segment costs more & looks spammy).
// Includes opt-out token "STOP" framing for TCPA defense.

export interface SmsArgs {
  firstName?: string | null;
  brokerage?: string | null;
  trackUrl: string;
}

export function renderSms(args: SmsArgs): string {
  const name = (args.firstName ?? "").split(" ")[0]?.trim();
  const opener = name ? `Hey ${name},` : `Hey,`;
  // Keep concise. Single tracked link. Sender ID + STOP at end.
  return `${opener} I built a tool that grades your last life ins call & shows the 3 things to fix. First one's free: ${args.trackUrl}  -Tyler. Reply STOP to opt out.`;
}
