// Outscraper Email & Contact Finder.
//
// Given an agency website domain, this hits Outscraper's emails-and-contacts
// endpoint (synchronous mode for simplicity) and returns ScrapedAgent records
// for each PERSONAL email it finds — typically firstname@, firstname.lastname@,
// flastname@ patterns published somewhere on the site (about/team/contact pages).
//
// What this is NOT:
//   - A full pattern guesser. It only returns emails Outscraper actually saw
//     on the public web. No SMTP probing, no "guess and verify".
//   - A directory of agents. We seed it with domains we already know about.
//
// Cost: ~$0.001-$0.01 per domain.
// Free tier on signup typically covers the first ~50-100 lookups.

import type { ScrapedAgent } from "./types";

const OUTSCRAPER_API_BASE = "https://api.app.outscraper.com";

// One row per domain; emails come back as parallel email_1..email_n fields.
interface OutscraperContactRow {
  site?: string;
  domain?: string;
  query?: string;
  email_1?: string;       email_1_full_name?: string;       email_1_position?: string;
  email_2?: string;       email_2_full_name?: string;       email_2_position?: string;
  email_3?: string;       email_3_full_name?: string;       email_3_position?: string;
  email_4?: string;       email_4_full_name?: string;       email_4_position?: string;
  email_5?: string;       email_5_full_name?: string;       email_5_position?: string;
  email_6?: string;       email_6_full_name?: string;       email_6_position?: string;
  phone_1?: string;
  phone_2?: string;
  phone_3?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
}

async function outscraperRequest(path: string, params: Record<string, string | number>, apiKey: string): Promise<any> {
  const u = new URL(OUTSCRAPER_API_BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u.toString(), {
    headers: { "X-API-KEY": apiKey, "accept": "application/json" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Outscraper ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Fetch personal emails for one domain.
 * Outscraper's sync mode returns: { data: [ [{site, email_1, ...}] ] }
 * (one inner array per query — we send one query at a time).
 */
export async function findEmailsForDomain(domain: string, apiKey: string): Promise<ScrapedAgent[]> {
  const data = await outscraperRequest("/emails-and-contacts", {
    query: domain,
    async: "false",
  }, apiKey);

  // Flatten the nested-array response shape.
  const rows: OutscraperContactRow[] = [];
  for (const group of data?.data ?? []) {
    if (Array.isArray(group)) rows.push(...group);
    else if (group && typeof group === "object") rows.push(group);
  }
  if (rows.length === 0) return [];

  const out: ScrapedAgent[] = [];
  for (const row of rows) {
    const site = row.site || row.domain || row.query || domain;
    for (let i = 1; i <= 6; i++) {
      const email = (row as any)[`email_${i}`] as string | undefined;
      if (!email) continue;
      const cleaned = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) continue;

      const fullName = ((row as any)[`email_${i}_full_name`] as string | undefined)?.trim() || null;
      const position = ((row as any)[`email_${i}_position`] as string | undefined)?.trim() || null;
      const [first, ...rest] = (fullName ?? "").split(/\s+/).filter(Boolean);
      const last = rest.length ? rest[rest.length - 1] : null;

      out.push({
        email: cleaned,
        first_name: first || null,
        last_name: last || null,
        full_name: fullName,
        phone: (row.phone_1 ?? row.phone_2 ?? row.phone_3 ?? null)?.trim() || null,
        brokerage: null,        // domain-level — caller can backfill
        agency: null,
        source_url: site || null,
        raw_payload: {
          provider: "outscraper_emails",
          position,
          facebook: row.facebook ?? null,
          instagram: row.instagram ?? null,
          linkedin: row.linkedin ?? null,
          twitter: row.twitter ?? null,
          domain_queried: domain,
        },
      });
    }
  }
  return out;
}
