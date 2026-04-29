#!/usr/bin/env tsx
/**
 * Phone-first scraper runner. Calls the Outscraper Google Maps scraper, runs
 * the AIL/Globe filter, and writes to public.outreach_agents.
 *
 * Two-phase write to avoid clobbering existing rows:
 *   Phase 1: INSERT new rows (ignoreDuplicates: true on email_normalized)
 *            — only NEW emails actually get inserted; existing rows untouched.
 *   Phase 2: For records whose email already existed, UPDATE only phone +
 *            phone_normalized + source enrichment when the existing row has
 *            phone_normalized IS NULL. We never overwrite an existing phone
 *            and never touch unrelated fields like `excluded` / `brokerage` /
 *            opt-out timestamps.
 *
 * Phone-only records (synthesized email phone{digits}@noemail.local) are also
 * inserted into public.outreach_suppressions so the email batcher never tries
 * to deliver to them. They surface in the SMS launcher (which filters
 * excluded=false AND phone_normalized IS NOT NULL).
 *
 * Targets the public schema directly with prefixed table names.
 *
 * Usage:
 *   tsx scripts/scrape-phones.ts            # default 500 rec cap
 *   tsx scripts/scrape-phones.ts --limit 100
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUTSCRAPER_API_KEY
 * Env optional:
 *   OUTSCRAPER_LIMIT_PER_QUERY  default 50
 *   OUTSCRAPER_CITIES_PER_RUN   default 10
 *   SCRAPE_PHONES_LIMIT         hard cap (default 500)
 */
import { createClient } from "@supabase/supabase-js";
import { outscraperScraper } from "../lib/scrapers/outscraper";
import { classify } from "../lib/filters/exclude";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = envOrDie("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");

if (!process.env.OUTSCRAPER_API_KEY) {
  console.warn("WARN: OUTSCRAPER_API_KEY not set; nothing will happen.");
}

const args = process.argv.slice(2);
const limitFlagIdx = args.indexOf("--limit");
const cliLimit = limitFlagIdx !== -1 ? parseInt(args[limitFlagIdx + 1] ?? "500", 10) : null;
const HARD_LIMIT = cliLimit ?? parseInt(process.env.SCRAPE_PHONES_LIMIT ?? "500", 10);

// Override the scraper's defaults for a phone-enrichment run: target more
// cities so we don't keep hitting the same 2 metros.
if (!process.env.OUTSCRAPER_CITIES_PER_RUN) process.env.OUTSCRAPER_CITIES_PER_RUN = "10";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null;
}

function emailNormalize(email: string): string {
  return email.toLowerCase().trim();
}

async function main() {
  console.log(`scrape-phones: HARD_LIMIT=${HARD_LIMIT}`);
  let agents;
  try {
    agents = await outscraperScraper.scrape(HARD_LIMIT);
  } catch (e: any) {
    console.error(`outscraper failed: ${e.message}`);
    process.exit(1);
  }
  console.log(`outscraper returned ${agents.length} candidate records`);
  if (agents.length === 0) {
    console.log("nothing to write");
    return;
  }

  // Intra-batch dedup by email_normalized.
  const byEmail = new Map<string, (typeof agents)[number]>();
  for (const a of agents) {
    const k = emailNormalize(a.email);
    if (!byEmail.has(k)) byEmail.set(k, a);
  }
  const deduped = [...byEmail.values()];
  console.log(`after intra-batch dedup: ${deduped.length}`);

  // Build records.
  const records = deduped.map((a) => {
    const cls = classify(a);
    const phoneNormalized = normalizePhone(a.phone ?? null);
    return {
      email: a.email,
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
      full_name: a.full_name ?? null,
      phone: a.phone ?? null,
      phone_normalized: phoneNormalized,
      brokerage: a.brokerage ?? null,
      agency: a.agency ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      zip: a.zip ?? null,
      carriers: a.carriers ?? null,
      source: outscraperScraper.source,
      source_url: a.source_url ?? null,
      raw_payload: a.raw_payload ?? a,
      excluded: cls.excluded,
      excluded_reason: cls.reason ?? null,
    };
  });

  // ---- Phase 1: insert new rows only ----
  let newRows = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { data, error } = await sb
      .from("outreach_agents")
      .upsert(batch, { onConflict: "email_normalized", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error(`insert error: ${error.message}`);
      process.exit(1);
    }
    newRows += data?.length ?? 0;
    process.stdout.write(".");
  }
  console.log(`\nphase 1: ${newRows} new rows inserted`);

  // ---- Phase 2: enrich existing rows with phone_normalized (only when existing row has none) ----
  let enriched = 0;
  let enrichSkipped = 0;
  const recordsWithPhone = records.filter((r) => r.phone_normalized);
  console.log(`phase 2: ${recordsWithPhone.length} records carry a phone — checking for existing matches without phone…`);
  for (const r of recordsWithPhone) {
    const emailKey = emailNormalize(r.email);
    // Update phone fields only when the existing row has none, leaving every
    // other column (especially `excluded`, `unsubscribed_at`) untouched.
    const { data, error } = await sb
      .from("outreach_agents")
      .update({
        phone: r.phone,
        phone_normalized: r.phone_normalized,
        // Don't overwrite source — leave whatever scraper found them first.
      })
      .eq("email_normalized", emailKey)
      .is("phone_normalized", null)
      .select("id");
    if (error) {
      console.warn(`update error for ${emailKey}: ${error.message}`);
      enrichSkipped++;
      continue;
    }
    if ((data?.length ?? 0) > 0) enriched++;
  }
  console.log(`phase 2: enriched ${enriched} existing rows (${enrichSkipped} update errors)`);

  // ---- Suppress synthetic phone-only emails ----
  const syntheticEmails = records
    .filter((r) => r.email.endsWith("@noemail.local"))
    .map((r) => emailNormalize(r.email));
  if (syntheticEmails.length > 0) {
    // suppressions.reason is CHECK-constrained to a fixed enum
    // ('unsubscribe' | 'complaint' | 'hard_bounce' | 'manual' | 'imported').
    // 'manual' is the closest fit for "we manufactured this address; don't email it".
    const suppressionRecords = syntheticEmails.map((email) => ({
      email_normalized: email,
      reason: "manual",
    }));
    const { error: supErr } = await sb
      .from("outreach_suppressions")
      .upsert(suppressionRecords, { onConflict: "email_normalized", ignoreDuplicates: true });
    if (supErr) {
      console.warn(`suppression upsert warning: ${supErr.message}`);
    } else {
      console.log(`suppressed ${syntheticEmails.length} synthetic emails`);
    }
  }

  // ---- Final tallies ----
  const { count: totalEligible } = await sb
    .from("outreach_agents")
    .select("id", { count: "exact", head: true })
    .eq("excluded", false);
  const { count: smsable } = await sb
    .from("outreach_agents")
    .select("id", { count: "exact", head: true })
    .eq("excluded", false)
    .not("phone_normalized", "is", null);
  console.log(`Total eligible agents: ${totalEligible}. With phone (SMS-eligible): ${smsable}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
