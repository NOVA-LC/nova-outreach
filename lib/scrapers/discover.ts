// Brave Search–powered discovery scraper. Runs queries that surface independent
// life-insurance agent websites; fetches top results; extracts emails.
//
// Why Brave: free tier is 2,000 queries/month, no Cloudflare-style bot fight
// like Google. https://api.search.brave.com/app/keys
//
// If BRAVE_SEARCH_API_KEY isn't set, this scraper degrades to a no-op so the
// app still deploys. Add the key in Vercel env to activate.
//
// Pattern of a query: site-restricted to .com, body matches "life insurance
// agent" + a state, body contains an "@" (likely an email). We then fetch each
// result page and regex-extract emails not on AIL/Globe domains.

import * as cheerio from "cheerio";
import type { Scraper, ScrapedAgent } from "./types";
import { classify } from "../filters/exclude";

const UA = "NovaIntelOutreachBot/0.1 (+https://novaintel.io; tyler@gonenova.com)";

// Rotate states so each daily run touches a different slice of the country.
const STATES = [
  "Texas", "Florida", "Georgia", "California", "North Carolina", "Ohio",
  "Pennsylvania", "Illinois", "Tennessee", "Arizona", "Virginia", "Michigan",
  "Indiana", "Missouri", "Colorado", "Alabama", "South Carolina", "Wisconsin",
];

function todaysStates(): string[] {
  // Bootstrap mode: hit ALL states in one run. Daily cron should
  // re-narrow to 3/day to avoid burning Brave quota — see DAILY_MODE flag.
  if (process.env.SCRAPE_ALL_STATES === "true") return STATES.slice();
  const day = new Date().getUTCDate();
  const start = (day * 3) % STATES.length;
  return [
    STATES[start],
    STATES[(start + 1) % STATES.length],
    STATES[(start + 2) % STATES.length],
  ];
}

const QUERY_TEMPLATES = [
  '"life insurance agent" "{state}" "@gmail.com"',
  '"licensed life insurance" "{state}" contact',
  '"final expense agent" "{state}" "@"',
  'independent life insurance agent {state} email',
];

interface BraveResult {
  url: string;
  title: string;
  description: string;
}

async function braveSearch(q: string, key: string): Promise<BraveResult[]> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", q);
  u.searchParams.set("count", "20");
  const res = await fetch(u.toString(), {
    headers: { "X-Subscription-Token": key, "Accept": "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`brave search ${res.status}`);
  const json: any = await res.json();
  const results = json?.web?.results ?? [];
  return results.map((r: any) => ({
    url: r.url,
    title: r.title ?? "",
    description: r.description ?? "",
  }));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const BAD_DOMAINS = new Set([
  "facebook.com", "twitter.com", "linkedin.com", "instagram.com",
  "wixpress.com", "wordpress.com", "godaddy.com", "wix.com",
  "gravatar.com", "sentry-next.wixpress.com", "google.com",
]);

function looksLikeAgent(email: string, pageText: string): boolean {
  const lc = pageText.toLowerCase();
  return (
    lc.includes("life insurance") ||
    lc.includes("final expense") ||
    lc.includes("medicare") ||
    lc.includes("annuity") ||
    lc.includes("licensed agent") ||
    lc.includes("independent agent")
  );
}

async function fetchAndExtract(url: string): Promise<ScrapedAgent[]> {
  let html = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.headers.get("content-type")?.includes("html")) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const text = $("body").text();
  if (!looksLikeAgent("", text)) return [];

  const title = $("title").first().text().trim();
  const out: ScrapedAgent[] = [];
  const seen = new Set<string>();

  // Try mailto: links first — highest fidelity.
  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/, "").split("?")[0].trim().toLowerCase();
    if (!email || seen.has(email)) return;
    const dom = email.split("@")[1] ?? "";
    if (BAD_DOMAINS.has(dom)) return;
    seen.add(email);
    out.push({ email, full_name: title || null, source_url: url, raw_payload: { context: "mailto", title } });
  });

  // Fall back to text-extraction.
  const matches = text.match(EMAIL_RE) ?? [];
  for (const m of matches) {
    const email = m.toLowerCase();
    if (seen.has(email)) continue;
    const dom = email.split("@")[1] ?? "";
    if (BAD_DOMAINS.has(dom)) continue;
    // Drop obvious non-agents (vendor emails, system addresses).
    if (/^(info|support|contact|admin|sales|hello|hi|noreply|no-reply|submissions?|agency|insurance|claims|billing|accounts?|accounting|marketing|media|press|careers|jobs|hr|office|mail|customerservice|customer|service|help|team|ask|inquir(y|ies)|quotes?|quoting|get(started)?|request|reception|frontdesk|main|general|enroll(ment)?)@/.test(email)) continue;
    seen.add(email);
    out.push({ email, full_name: title || null, source_url: url, raw_payload: { context: "text", title } });
  }

  return out;
}

export const discoverScraper: Scraper = {
  name: "discover_brave",
  source: "discover_brave",
  scrape: async (limitArg = 200) => {
    // Bootstrap mode: ignore caller's limit, take everything we can.
    const limit = process.env.SCRAPE_ALL_STATES === "true" ? 2000 : limitArg;
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) {
      console.log("BRAVE_SEARCH_API_KEY not set; skipping discover scraper");
      return [];
    }
    const states = todaysStates();
    const queries = states.flatMap((s) =>
      QUERY_TEMPLATES.map((t) => t.replace("{state}", s)),
    );

    const all: ScrapedAgent[] = [];
    for (const q of queries) {
      let results: BraveResult[];
      try {
        results = await braveSearch(q, key);
      } catch (e) {
        console.warn("brave search failed:", q, e);
        continue;
      }
      for (const r of results) {
        if (all.length >= limit) break;
        const found = await fetchAndExtract(r.url);
        for (const a of found) {
          // Drop the exclude-by-carrier matches early.
          if (!classify(a).excluded) all.push(a);
        }
        await new Promise((res) => setTimeout(res, 800));
      }
      if (all.length >= limit) break;
    }
    return all.slice(0, limit);
  },
};
