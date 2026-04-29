// Outscraper-powered lead source.
//
// Uses Outscraper's Google Maps search API to pull life-insurance agent
// businesses by city/state. Each result has name, phone, website, and often
// an email already. For results without email, we follow up with Outscraper's
// Emails & Contacts API on the website domain.
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
  { city: "Miami", state: "FL" },
  { city: "Tampa", state: "FL" },
  { city: "Phoenix", state: "AZ" },
  { city: "Charlotte", state: "NC" },
  { city: "Nashville", state: "TN" },
  { city: "Indianapolis", state: "IN" },
  { city: "Columbus", state: "OH" },
  { city: "Cincinnati", state: "OH" },
  { city: "Kansas City", state: "MO" },
  { city: "Denver", state: "CO" },
  { city: "Las Vegas", state: "NV" },
  { city: "Jacksonville", state: "FL" },
];

// Pick 2 cities per day so we hit the whole list every ~7-8 days, building
// a deep national database without re-pulling the same city repeatedly.
function todaysCities(): { city: string; state: string }[] {
  const day = new Date().getUTCDate();
  const start = (day * 2) % TARGET_CITIES.length;
  return [TARGET_CITIES[start], TARGET_CITIES[(start + 1) % TARGET_CITIES.length]];
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
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Outscraper ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// "life insurance agent Atlanta, GA" → up to 50 places with email/phone/site.
async function searchAgents(city: string, state: string, apiKey: string): Promise<OutscraperPlace[]> {
  // async=false returns results inline (sync mode); capped to small queries
  // but plenty for our 50-100/day target.
  const data = await outscraperRequest("/maps/search-v3", {
    query: `life insurance agent ${city}, ${state}`,
    limit: 50,
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

function placeToAgent(p: OutscraperPlace, sourceUrl: string): ScrapedAgent | null {
  const email = (p.email_1 || p.email_2 || p.email_3 || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    email,
    full_name: p.name ?? null,
    phone: p.phone ?? null,
    brokerage: p.name ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    zip: p.postal_code ?? null,
    source_url: p.site ?? sourceUrl,
    raw_payload: { provider: "outscraper", category: p.category, description: p.description, full_address: p.full_address },
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
    const out: ScrapedAgent[] = [];
    const targets = todaysCities();
    console.log(`[outscraper] today's cities: ${targets.map((t) => `${t.city}, ${t.state}`).join("; ")}`);

    for (const t of targets) {
      if (out.length >= limit) break;
      let places: OutscraperPlace[] = [];
      try {
        places = await searchAgents(t.city, t.state, apiKey);
      } catch (e: any) {
        console.warn(`[outscraper] ${t.city}, ${t.state} failed:`, e?.message ?? e);
        continue;
      }
      const sourceUrl = `outscraper://maps/${encodeURIComponent(t.city + "," + t.state)}`;
      let added = 0;
      for (const p of places) {
        if (out.length >= limit) break;
        const agent = placeToAgent(p, sourceUrl);
        if (agent) { out.push(agent); added++; }
      }
      console.log(`[outscraper] ${t.city}, ${t.state}: ${places.length} places → ${added} with email`);
    }
    console.log(`[outscraper] total before dedupe: ${out.length}`);
    return out;
  },
};
