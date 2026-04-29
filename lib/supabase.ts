import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Server-side client using the service role key. Bypasses RLS.
//
// All outreach tables live in `public` with an `outreach_` prefix
// (outreach_agents, outreach_sends, outreach_campaigns, ...). The default
// schema is therefore `public` — no schema override needed.
export function db() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Alias kept for clarity at call sites that explicitly mean "public schema"
// (e.g. reading public.free_analysis_results for conversion attribution).
export function publicDb() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
