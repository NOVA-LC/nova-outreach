#!/usr/bin/env tsx
/**
 * Domain-level personal-email enrichment via Outscraper's email finder.
 *
 * Pulls unique business email domains from public.outreach_agents (skipping
 * freemail, carriers, and the obvious non-agent domains we've seen pollute
 * the pool), then runs Outscraper's emails-and-contacts API per domain to
 * find named-employee addresses (firstname@, firstname.lastname@, etc.).
 *
 * For each personal email returned:
 *   - run classify() to drop role addresses + AIL/Globe/captives + carriers
 *   - upsert into public.outreach_agents on email_normalized; new rows only
 *     (won't clobber existing rows)
 *   - new rows have source = 'outscraper_emails'
 *
 * Cost: ~$0.001-$0.01 per domain. Default cap = 200 domains/run (~$2).
 *
 * Usage:
 *   tsx scripts/enrich-emails.ts            # 200 domains
 *   tsx scripts/enrich-emails.ts --limit 50
 *   tsx scripts/enrich-emails.ts --domain hughesinsurance.com   # one-off probe
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OUTSCRAPER_API_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { findEmailsForBatch, findEmailsForDomain } from "../lib/scrapers/outscraper_emails";
import { classify } from "../lib/filters/exclude";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = envOrDie("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
const OUTSCRAPER_API_KEY = envOrDie("OUTSCRAPER_API_KEY");

const args = process.argv.slice(2);
function flag(name: string, def: string | null): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? def) : def;
}
const HARD_LIMIT = parseInt(flag("--limit", null) ?? process.env.ENRICH_EMAILS_LIMIT ?? "200", 10);
const SINGLE_DOMAIN = flag("--domain", null);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Domains we never want to enrich — freemail providers, big carriers, gov, edu.
const SKIP_DOMAINS = new Set([
  "gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com",
  "me.com","msn.com","live.com","comcast.net","verizon.net","att.net",
  "sbcglobal.net","bellsouth.net","cox.net","protonmail.com","mac.com",
  "ymail.com","rocketmail.com","gmx.com","fastmail.com",
  "trustedchoice.com","foresters.com","independent.life","afslife.com",
  "facebook.com","linkedin.com","instagram.com","twitter.com","x.com",
  "mutualofomaha.com","newyorklife.com","statefarm.com","allstate.com",
  "farmers.com","nationwide.com","prudential.com","metlife.com",
  "lincolnfinancial.com","transamerica.com","johnhancock.com",
  "massmutual.com","primerica.com","healthmarkets.com",
  "noemail.local",
]);

function isSkippable(domain: string): boolean {
  if (!domain) return true;
  if (SKIP_DOMAINS.has(domain)) return true;
  if (/\.(gov|edu|mil)$/i.test(domain)) return true;
  // Apex domains too short to be agency websites
  if (domain.length < 5) return true;
  return false;
}

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null;
}

async function pickDomains(limit: number): Promise<string[]> {
  if (SINGLE_DOMAIN) return [SINGLE_DOMAIN.toLowerCase()];

  // Pull a chunk of agent emails, derive domains, dedup, filter.
  // We page through to assemble a unique set up to the cap.
  const wanted = new Set<string>();
  const page = 5000;
  for (let offset = 0; wanted.size < limit; offset += page) {
    const { data, error } = await sb
      .from("outreach_agents")
      .select("email")
      .eq("excluded", false)
      .not("email", "ilike", "%@noemail.local")
      .order("scraped_at", { ascending: false })
      .range(offset, offset + page - 1);
    if (error) { console.error("page error:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const email = (row.email ?? "").toLowerCase();
      const dom = email.split("@")[1] ?? "";
      if (isSkippable(dom)) continue;
      // Optional: skip domains we've already enriched in a prior run.
      wanted.add(dom);
      if (wanted.size >= limit) break;
    }
    if (data.length < page) break;
  }

  // Skip domains we've already enriched (rows from outscraper_emails source).
  const candidates = [...wanted];
  if (candidates.length === 0) return [];

  const { data: enriched } = await sb
    .from("outreach_agents")
    .select("email")
    .eq("source", "outscraper_emails")
    .in("email", candidates.map((d) => `noop@${d}`)); // dummy; we'll dedupe ourselves below
  void enriched; // unused — just keeping the table happy.
  // Real already-enriched check: see if any rows exist with email-domain in candidate set.
  const { data: prior } = await sb
    .from("outreach_agents")
    .select("email")
    .eq("source", "outscraper_emails");
  const priorDomains = new Set<string>();
  for (const r of prior ?? []) {
    const d = (r.email ?? "").toLowerCase().split("@")[1] ?? "";
    if (d) priorDomains.add(d);
  }
  return candidates.filter((d) => !priorDomains.has(d)).slice(0, limit);
}

async function main() {
  console.log(`enrich-emails: HARD_LIMIT=${HARD_LIMIT}${SINGLE_DOMAIN ? ` (single=${SINGLE_DOMAIN})` : ""}`);
  const domains = await pickDomains(HARD_LIMIT);
  console.log(`picked ${domains.length} domains to enrich`);
  if (domains.length === 0) {
    console.log("nothing to do");
    return;
  }

  const records: any[] = [];
  let domainOK = 0, domainErr = 0, emailsFound = 0;

  // Outscraper's emails-and-contacts is async-only. We batch up to 25 domains
  // per job to keep the wallclock down — 1 poll cycle per 25 domains instead
  // of one per domain.
  let perDomain: Map<string, any[]>;
  if (SINGLE_DOMAIN) {
    const agents = await findEmailsForDomain(domains[0], OUTSCRAPER_API_KEY);
    perDomain = new Map([[domains[0], agents]]);
    domainOK = 1;
  } else {
    try {
      perDomain = await findEmailsForBatch(domains, OUTSCRAPER_API_KEY, 25);
      domainOK = domains.length;
    } catch (e: any) {
      console.error(`batch enrichment failed: ${e.message ?? e}`);
      perDomain = new Map();
      domainErr = domains.length;
    }
  }

  for (const [domain, agents] of perDomain) {
    console.log(`  ${domain}: ${agents.length} email(s)`);
    for (const a of agents) {
      const cls = classify(a);
      if (cls.excluded) continue; // role/captive/carrier — skip
      emailsFound++;
      records.push({
        email: a.email,
        first_name: a.first_name ?? null,
        last_name: a.last_name ?? null,
        full_name: a.full_name ?? null,
        phone: a.phone ?? null,
        phone_normalized: normalizePhone(a.phone ?? null),
        brokerage: a.brokerage ?? null,
        agency: a.agency ?? null,
        city: a.city ?? null,
        state: a.state ?? null,
        zip: a.zip ?? null,
        carriers: a.carriers ?? null,
        source: "outscraper_emails",
        source_url: a.source_url ?? null,
        raw_payload: a.raw_payload ?? a,
        excluded: false,
        excluded_reason: null,
      });
    }
  }

  console.log(`\n${domainOK}/${domains.length} domains succeeded (${domainErr} errors). ${emailsFound} eligible emails after filter.`);

  if (records.length === 0) return;

  // Phase 1: insert new rows only (don't disturb existing ones).
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { data, error } = await sb
      .from("outreach_agents")
      .upsert(batch, { onConflict: "email_normalized", ignoreDuplicates: true })
      .select("id");
    if (error) { console.error("insert error:", error.message); continue; }
    inserted += data?.length ?? 0;
  }
  console.log(`inserted ${inserted} new rows (others were duplicates of existing emails)`);

  // Final tally
  const { count: eligible } = await sb
    .from("outreach_agents")
    .select("id", { count: "exact", head: true })
    .eq("excluded", false);
  console.log(`Total eligible agents now: ${eligible}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
