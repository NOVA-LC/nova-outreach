// Lazy env access. Reading at module-load was breaking Vercel's static-page
// generation when env vars hadn't been wired up yet — getters defer the read
// to actual call sites. Missing envs return empty strings; downstream code
// fails clearly at runtime instead of bombing the build.

function read(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get SUPABASE_URL()              { return read("SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return read("SUPABASE_SERVICE_ROLE_KEY"); },
  get RESEND_API_KEY()            { return read("RESEND_API_KEY"); },
  get RESEND_WEBHOOK_SECRET()     { return read("RESEND_WEBHOOK_SECRET"); },

  get APP_URL()       { return read("APP_URL", "https://novaintel.io"); },
  get CRON_SECRET()   { return read("CRON_SECRET"); },
  get SCRAPE_SECRET() { return read("SCRAPE_SECRET"); },

  get FROM_EMAIL() { return read("FROM_EMAIL", "tyler@gonenova.com"); },
  get FROM_NAME()  { return read("FROM_NAME", "Tyler"); },
  get REPLY_TO()   { return read("REPLY_TO", "tyler@gonenova.com"); },

  get COMPLIANCE_ADDRESS() { return read("COMPLIANCE_ADDRESS", "Nova Intel, Atlanta, GA"); },

  get DAILY_SEND_CAP() { return parseInt(read("DAILY_SEND_CAP", "100"), 10); },
  get PER_RUN_CAP()    { return parseInt(read("PER_RUN_CAP", "6"), 10); },

  get TWILIO_ACCOUNT_SID()  { return read("TWILIO_ACCOUNT_SID"); },
  get TWILIO_AUTH_TOKEN()   { return read("TWILIO_AUTH_TOKEN"); },
  get TWILIO_FROM_NUMBER()  { return read("TWILIO_FROM_NUMBER"); },
};
