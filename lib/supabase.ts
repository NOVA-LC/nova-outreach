import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Server-side client using service role. Bypasses RLS. Schema selection
// is needed because outreach.* tables aren't on the default public schema.
export function db() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Separate handle for reading the public schema (e.g., free_analysis_results join).
export function publicDb() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
}
