// Subject line bank — A/B candidates. Picked round-robin per send.
// Goal: punchy, lower-cased, conversational, references something only-an-agent-knows.
// Avoid spam triggers: $$$, FREE, !!!, "limited time", etc.

export const SUBJECT_VARIANTS: string[] = [
  "your last call probably had 11 mistakes",
  "the 3 things you said yesterday that cost you the policy",
  "saw your call grade was a 22",                  // intentional vagueness
  "23 minutes between you and a B+ closing call",
  "what 'wasn't enough' actually looks like",
  "fixable: discovery depth, 10% developed",
];

export function pickSubject(seed: string | number): string {
  // Stable per-recipient choice so retries don't change subjects.
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % SUBJECT_VARIANTS.length;
  return SUBJECT_VARIANTS[idx];
}
