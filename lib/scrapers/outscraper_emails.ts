// Outscraper Email & Contact Finder.
//
// Async + batched: Outscraper's emails-and-contacts endpoint runs as a job.
// Sync mode (`async=false`) silently returns no data on this endpoint, so we
// always start a job and poll results_location until status === "Success".
//
// We batch up to 25 domains per job — Outscraper accepts repeated `query`
// params so 25 lookups become 1 HTTP roundtrip + 1 poll cycle. Drastically
// cheaper on time vs. 1 job per domain.

import type { ScrapedAgent } from "./types";

const OUTSCRAPER_API_BASE = "https://api.app.outscraper.com";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;   // 6 min — large batches can take a while
const DEFAULT_BATCH_SIZE = 25;

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

interface AsyncStartResp {
  id?: string;
  status?: string;
  results_location?: string;
  data?: any;
}

interface AsyncPollResp {
  id?: string;
  status?: string;     // "Pending" | "Success" | "Failed"
  data?: any[][] | any[] | null;
  results_location?: string;
}

async function startBatchJob(domains: string[], apiKey: string): Promise<AsyncStartResp> {
  // Outscraper accepts repeated `query` params for batch jobs.
  const u = new URL(`${OUTSCRAPER_API_BASE}/emails-and-contacts`);
  for (const d of domains) u.searchParams.append("query", d);
  u.searchParams.set("async", "true");
  const res = await fetch(u.toString(), {
    method: "GET",
    headers: { "X-API-KEY": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`emails-and-contacts start ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function pollJob(resultsUrl: string, apiKey: string): Promise<AsyncPollResp> {
  const start = Date.now();
  let lastStatus = "Pending";
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(resultsUrl, {
      headers: { "X-API-KEY": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const json = (await res.json()) as AsyncPollResp;
      lastStatus = json.status ?? "?";
      const status = lastStatus.toLowerCase();
      if (status === "success") return json;
      if (status === "failed" || status === "error") {
        throw new Error(`outscraper job failed: ${JSON.stringify(json).slice(0, 300)}`);
      }
    } else if (res.status >= 500 || res.status === 404) {
      // transient
    } else {
      throw new Error(`poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timed out (${Math.round(POLL_TIMEOUT_MS / 1000)}s, last status=${lastStatus})`);
}

function flattenRows(resp: AsyncPollResp): OutscraperContactRow[] {
  const rows: OutscraperContactRow[] = [];
  const d: any = resp.data;
  if (!d) return rows;
  if (Array.isArray(d) && d.length && Array.isArray(d[0])) {
    for (const inner of d as any[][]) for (const row of inner) rows.push(row as OutscraperContactRow);
  } else if (Array.isArray(d)) {
    for (const row of d as any[]) rows.push(row as OutscraperContactRow);
  }
  return rows;
}

function rowToAgents(row: OutscraperContactRow, fallbackDomain: string): ScrapedAgent[] {
  const site = row.site || row.domain || row.query || fallbackDomain;
  const out: ScrapedAgent[] = [];
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
      brokerage: null,
      agency: null,
      source_url: site || null,
      raw_payload: {
        provider: "outscraper_emails",
        position,
        facebook: row.facebook ?? null,
        instagram: row.instagram ?? null,
        linkedin: row.linkedin ?? null,
        twitter: row.twitter ?? null,
        domain_queried: row.query ?? fallbackDomain,
      },
    });
  }
  return out;
}

/**
 * Process a batch of up to N domains in one Outscraper job.
 * Returns a Map<domain, ScrapedAgent[]> so the caller can log per-domain counts.
 */
export async function findEmailsForBatch(
  domains: string[],
  apiKey: string,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<Map<string, ScrapedAgent[]>> {
  const result = new Map<string, ScrapedAgent[]>();
  for (const d of domains) result.set(d, []);

  for (let i = 0; i < domains.length; i += batchSize) {
    const slice = domains.slice(i, i + batchSize);
    let init: AsyncStartResp;
    try {
      init = await startBatchJob(slice, apiKey);
    } catch (e: any) {
      console.warn(`  batch start failed (${slice.length} domains): ${e.message}`);
      continue;
    }
    if (!init.results_location) {
      console.warn(`  no results_location for batch ${i}-${i + slice.length}: ${JSON.stringify(init).slice(0, 200)}`);
      continue;
    }
    let final: AsyncPollResp;
    try {
      final = await pollJob(init.results_location, apiKey);
    } catch (e: any) {
      console.warn(`  batch poll failed: ${e.message}`);
      continue;
    }
    const rows = flattenRows(final);
    // Rows are returned in query-order. Match each row to its source domain.
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      const fallback = slice[k] ?? slice[0];
      const agents = rowToAgents(row, fallback);
      const key = (row.query ?? fallback).toLowerCase();
      const list = result.get(key) ?? result.get(fallback) ?? [];
      list.push(...agents);
      if (!result.has(key)) result.set(key, list);
      else result.set(key, list);
    }
  }
  return result;
}

/**
 * Single-domain convenience wrapper for the --domain CLI flag.
 */
export async function findEmailsForDomain(domain: string, apiKey: string): Promise<ScrapedAgent[]> {
  const m = await findEmailsForBatch([domain], apiKey, 1);
  return m.get(domain) ?? [];
}
