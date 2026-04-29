// Outscraper-powered lead source.
//
// Uses Outscraper's Google Maps search API to pull life-insurance agent
// businesses by city/state. Each result has name, phone, website, and often
// an email already.
//
// Phone-only handling: results without a real email but WITH a phone are
// kept and stored under a synthetic key `phone${digits}@noemail.local`. The
// scrape-phones runner adds these synthetic emails to outreach_suppressions
// so the email batcher never tries them. They surface in the SMS launcher.
//
// Cost: ~$0.001 per Maps result + ~$0.01 per email lookup. ~$2-5 per 100 agents.
// Free tier: ~50 free credits when you sign up.
//
// The scraper rotates through cities so each daily run mines different markets.

import type { Scraper, ScrapedAgent } from "./types";

const OUTSCRAPER_API_BASE = "https://api.app.outscraper.com";

// Rotation list — large life-insurance markets, excluding states where AIL/Globe
// is dominant (TX, FL, GA, NC are still good despite some Torchmark presence;
// we filter at the agent level).
const TARGET_CITIES: { city: string; state: string }[] = [
  { city: "Atlanta", state: "GA" },
  { city: "Houston", state: "TX" },
  { city: "Dallas", state: "TX" },
  { city: "Austin", state: "TX" },
  { city: "Miami", state: "FL" },
  { city: "Tampa", state: "FL" },
  { city: "Orlando", state: "FL" },
  { city: "Jacksonville", state: "FL" },
  { city: "Phoenix", state: "AZ" },
  { city: "Charlotte", state: "NC" },
  { city: "Raleigh", state: "NC" },
  { city: "Nashville", state: "TN" },
  { city: "Memphis", state: "TN" },
  { city: "Indianapolis", state: "IN" },
  { city: "Columbus", state: "OH" },
  { city: "Cincinnati", state: "OH" },
  { city: "Cleveland", state: "OH" },
  { city: "Kansas City", state: "MO" },
  { city: "St. Louis", state: "MO" },
  { city: "Denver", state: "CO" },
  { city: "Las Vegas", state: "NV" },
  { city: "Birmingham", state: "AL" },
  { city: "Louisville", state: "KY" },
  { city: "Richmond", state: "VA" },
  { city: "Columbia", state: "SC" },
  { city: "Greenville", state: "SC" },
  { city: "New Orleans", state: "LA" },
  { city: "Oklahoma City", state: "OK" },
  { city: "Salt Lake City", state: "UT" },
];

// Pick N cities per run. Defaults to 2 (legacy daily-scrape behaviour); the
// scrape-phones runner overrides via OUTSCRAPER_CITIES_PER_RUN.
function todaysCities(perRun: number): { city: string; state: string }[] {
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const start = (day * perRun) % TARGET_CITIES.length;
  const out: { city: string; state: string }[] = [];
  for (let i = 0; i < perRun; i++) out.push(TARGET_CITIES[(start + i) % TARGET_CITIES.length]);
  return out;
}

interface OutscraperPlace {
  name?: string;
  full_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  phone?: string;
  email_1?: string;
  email_2?: string;
  email_3?: string;
  site?: string;
  category?: string;
  description?: string;
}

async function outscraperRequest(path: string, params: Record<string, string | number>, apiKey: string): Promise<any> {
  const u = new URL(OUTSCRAPER_API_BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u.toString(), {
    headers: { "X-API-KEY": apiKey, "accept": "application/json" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Outscraper ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// "life insurance agent Atlanta, GA" → up to N places with email/phone/site.
async function searchAgents(city: string, state: string, perQuery: number, apiKey: string): Promise<OutscraperPlace[]> {
  const data = await outscraperRequest("/maps/search-v3", {
    query: `life insurance agent ${city}, ${state}`,
    limit: perQuery,
    async: "false",
    fields: "name,full_address,city,state,postal_code,phone,email_1,email_2,email_3,site,category,description",
  }, apiKey);
  // Outscraper returns nested arrays: [[ {place}, {place}, ... ]]
  const flat: OutscraperPlace[] = [];
  for (const group of data?.data ?? []) {
    if (Array.isArray(group)) flat.push(...group);
    else if (group && typeof group === "object") flat.push(group);
  }
  return flat;
}

const SKIP_EMAIL_DOMAINS = new Set([
  "facebook.com", "instagram.com", "twitter.com", "linkedin.com",
  "wix.com", "wixpress.com", "squarespace.com", "godaddy.com",
]);

function pickEmail(p: OutscraperPlace): string | null {
  for (const raw of [p.email_1, p.email_2, p.email_3]) {
    const e = (raw ?? "").trim().toLowerCase();
    if (!e) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    const dom = e.split("@")[1] ?? "";
    if (SKIP_EMAIL_DOMAINS.has(dom)) continue;
    return e;
  }
  return null;
}

function placeToAgent(p: OutscraperPlace, sourceUrl: string): ScrapedAgent | null {
  const email = pickEmail(p);
  const phone = (p.phone ?? "").trim() || null;

  // Useless without either email or phone.
  if (!email && !phone) return null;

  // Phone-only: synthesize an email key. The scrape-phones runner will add
  // it to outreach_suppressions so the email batcher skips it.
  let resolvedEmail = email;
  if (!resolvedEmail) {
    const digits = (phone ?? "").replace(/\D+/g, "");
    if (!digits) return null;
    resolvedEmail = `phone${digits}@noemail.local`;
  }

  return {
    email: resolvedEmail,
    full_name: p.name ?? null,
    phone,
    brokerage: p.name ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    zip: p.postal_code ?? null,
    source_url: p.site ?? sourceUrl,
    raw_payload: {
      provider: "outscraper",
      category: p.category,
      description: p.description,
      full_address: p.full_address,
      email_source: email ? "outscraper" : "phone_only_synthetic",
    },
  };
}

export const outscraperScraper: Scraper = {
  name: "outscraper",
  source: "outscraper_google_maps",
  scrape: async (limit = 100) => {
    const apiKey = process.env.OUTSCRAPER_API_KEY;
    if (!apiKey) {
      console.log("OUTSCRAPER_API_KEY not set; skipping outscraper scraper");
      return [];
    }
    const perQuery = parseInt(process.env.OUTSCRAPER_LIMIT_PER_QUERY ?? "50", 10);
    const citiesPerRun = parseInt(process.env.OUTSCRAPER_CITIES_PER_RUN ?? "2", 10);

    const out: ScrapedAgent[] = [];
    const targets = todaysCities(citiesPerRun);
    console.log(`[outscraper] today's cities: ${targets.map((t) => `${t.city}, ${t.state}`).join("; ")}`);

    for (const t of targets) {
      if (out.length >= limit) break;
      let places: OutscraperPlace[] = [];
      try {
        places = await searchAgents(t.city, t.state, perQuery, apiKey);
      } catch (e: any) {
        console.warn(`[outscraper] ${t.city}, ${t.state} failed:`, e?.message ?? e);
        continue;
      }
      const sourceUrl = `outscraper://maps/${encodeURIComponent(t.city + "," + t.state)}`;
      let withEmail = 0, phoneOnly = 0;
      for (const p of places) {
        if (out.length >= limit) break;
        const agent = placeToAgent(p, sourceUrl);
        if (!agent) continue;
        out.push(agent);
        if (agent.email.endsWith("@noemail.local")) phoneOnly++; else withEmail++;
      }
      console.log(`[outscraper] ${t.city}, ${t.state}: ${places.length} places → ${withEmail} w/email, ${phoneOnly} phone-only`);
    }
    console.log(`[outscraper] total before dedupe: ${out.length}`);
    return out;
  },
};
