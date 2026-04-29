// Type-safe env access. Throws loudly at boot if required vars are missing.
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Required for any send (CLI or Vercel)
  SUPABASE_URL: req("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: req("SUPABASE_SERVICE_ROLE_KEY"),
  RESEND_API_KEY: req("RESEND_API_KEY"),
  APP_URL: req("APP_URL"),
  FROM_EMAIL: req("FROM_EMAIL"),

  // Optional — only needed by Vercel routes (CRON_SECRET, RESEND_WEBHOOK_SECRET,
  // SCRAPE_SECRET) or have sensible defaults. CLI runs in GitHub Actions don't need them.
  CRON_SECRET: opt("CRON_SECRET"),
  SCRAPE_SECRET: opt("SCRAPE_SECRET"),
  RESEND_WEBHOOK_SECRET: opt("RESEND_WEBHOOK_SECRET"),

  FROM_NAME: opt("FROM_NAME", "Tyler"),
  REPLY_TO: opt("REPLY_TO", "tyler@gonenova.com"),
  COMPLIANCE_ADDRESS: opt("COMPLIANCE_ADDRESS", "Nova Intel, Atlanta, GA"),

  DAILY_SEND_CAP: parseInt(opt("DAILY_SEND_CAP", "100"), 10),
  PER_RUN_CAP: parseInt(opt("PER_RUN_CAP", "6"), 10),

  // Twilio (later)
  TWILIO_ACCOUNT_SID: opt("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: opt("TWILIO_AUTH_TOKEN"),
  TWILIO_FROM_NUMBER: opt("TWILIO_FROM_NUMBER"),
};
