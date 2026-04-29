// Targeted IMO / brokerage / association scraper.
//
// Known life-insurance IMO universe (excluding AIL/Globe/Liberty National/Torchmark
// per Tyler's filter). For each, we try several common public-agent-finder URL
// patterns. Static HTML extraction; pages rendered client-side won't yield results
// (logged for debugging, swap to a Playwright-based path later if needed).

import * as cheerio from "cheerio";
import type { Scraper, ScrapedAgent } from "./types";

const UA = "NovaIntelOutreachBot/0.1 (+https://novaintel.io; tyler@gonenova.com)";

interface Source {
  label: string;
  base: string;
  // Candidate paths to try on the base. We hit each until we get >0 emails.
  paths: string[];
  // CSS selectors that often wrap agent listings; helps us isolate per-card data.
  cardSelectors?: string[];
  // Heuristic: pages that contain at least one of these strings are treated as
  // legitimate agent directories (filters out wrong landing pages we accidentally hit).
  validateContains?: string[];
}

// Curated non-AIL/Globe IMO + association directory list.
// Some of these will work first try, some won't (JS-rendered or moved URLs);
// the scraper logs what it found per source so we can iterate.
const SOURCES: Source[] = [
  // National Association of Insurance and Financial Advisors — opt-in directory
  { label: "naifa", base: "https://www.naifa.org",
    paths: ["/find-an-advisor", "/membership/find-an-advisor"],
    validateContains: ["advisor", "member"] },

  // Million Dollar Round Table — public member directory
  { label: "mdrt", base: "https://www.mdrt.org",
    paths: ["/find-a-financial-advisor", "/membership/directory"] },

  // National Association of Independent Life Brokerage Agencies
  { label: "nailba", base: "https://www.nailba.org",
    paths: ["/find-a-broker", "/member-directory"] },

  // Senior Market Sales — large IMO, public roster
  { label: "senior_market_sales", base: "https://www.seniormarketsales.com",
    paths: ["/about/our-team", "/our-team", "/team"] },

  // Symmetry Financial Group
  { label: "symmetry", base: "https://www.symmetryfinancialgroup.com",
    paths: ["/our-team", "/agents", "/leadership"] },

  // Equis Financial (formerly Christian Brothers)
  { label: "equis", base: "https://www.equisfinancial.com",
    paths: ["/our-team", "/leadership"] },

  // Family First Life
  { label: "family_first_life", base: "https://www.familyfirstlife.com",
    paths: ["/our-team", "/leadership", "/team"] },

  // Asurea / BankPath
  { label: "asurea", base: "https://www.asurea.com",
    paths: ["/our-team", "/team"] },

  // Mutual of Omaha — public agent finder (sometimes JS-rendered, may yield 0)
  { label: "mutual_of_omaha", base: "https://www.mutualofomaha.com",
    paths: ["/find-an-agent", "/insurance/local-agents"] },

  // Foresters Financial — broker locator
  { label: "foresters", base: "https://www.foresters.com",
    paths: ["/find-an-advisor", "/en-us/find-an-advisor"] },

  // Transamerica — agent finder
  { label: "transamerica", base: "https://www.transamerica.com",
    paths: ["/find-an-agent", "/individual/find-an-agent"] },

  // Nationwide — agent locator
  { label: "nationwide", base: "https://www.nationwide.com",
    paths: ["/agency-locator", "/personal/find-an-agent"] },

  // Aspire Financial Services (final expense IMO)
  { label: "aspire_financial", base: "https://aspirefinancialservices.com",
    paths: ["/our-team", "/team"] },

  // New Era Insurance
  { label: "new_era_insurance", base: "https://www.neweralife.com",
    paths: ["/find-an-agent", "/agents"] },

  // Sterling Capital Brokerage
  { label: "sterling_capital", base: "https://sterlingcapitalbrokerage.com",
    paths: ["/our-team", "/team"] },
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;
const BAD_DOMAINS = new Set([
  "facebook.com", "twitter.com", "linkedin.com", "instagram.com",
  "wixpress.com", "wordpress.com", "godaddy.com", "wix.com",
  "gravatar.com", "google.com", "youtube.com", "vimeo.com",
  "example.com", "example.org", "example.net",
  // AIL/Globe — also blocked here as defense in depth
  "ailife.com", "globelife.com", "globelifeinsurance.com",
  "libnat.com", "libertynational.com", "torchmarkcorp.com",
]);

async function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    if (!r.headers.get("content-type")?.includes("html")) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function extractFromPage(html: string, sourceUrl: string, label: string): ScrapedAgent[] {
  const $ = cheerio.load(html);
  const found = new Map<string, ScrapedAgent>();
  const titleHint = $("title").first().text().trim() || null;

  // 1. mailto: links — highest fidelity.
  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return;
    const dom = email.split("@")[1] ?? "";
    if (BAD_DOMAINS.has(dom)) return;
    if (found.has(email)) return;
    // Try to grab a name near the mailto link (parent text or aria-label).
    const $card = $(el).closest("article, .agent, .agent-card, .team-member, .person, .listing, li, div");
    const name = ($card.find("h1,h2,h3,h4,.name,.agent-name,.full-name").first().text().trim()
                  || $(el).attr("aria-label")
                  || null);
    found.set(email, {
      email,
      full_name: name,
      source_url: sourceUrl,
      raw_payload: { source: label, context: "mailto", titleHint },
    });
  });

  // 2. Body-text regex — lower fidelity but catches rendered emails.
  const bodyText = $("body").text();
  const matches = bodyText.match(EMAIL_RE) ?? [];
  for (const raw of matches) {
    const email = raw.toLowerCase();
    if (found.has(email)) continue;
    const dom = email.split("@")[1] ?? "";
    if (BAD_DOMAINS.has(dom)) continue;
    // Skip role / vendor / system addresses.
    if (/^(noreply|no-reply|donotreply|admin|webmaster|abuse|postmaster|info|hello|contact|sales|support)@/.test(email)) continue;
    found.set(email, {
      email,
      source_url: sourceUrl,
      raw_payload: { source: label, context: "text", titleHint },
    });
  }

  return [...found.values()];
}

export const knownDirectoriesScraper: Scraper = {
  name: "known_directories",
  source: "known_directories",
  scrape: async (limit = 500) => {
    const all: ScrapedAgent[] = [];
    const summary: Record<string, number> = {};

    outer: for (const src of SOURCES) {
      let perSource = 0;
      for (const path of src.paths) {
        if (all.length >= limit) break outer;
        const url = src.base + path;
        const html = await fetchHtml(url);
        if (!html) {
          await delay(500);
          continue;
        }
        // Validate we hit a real directory page, not e.g. a 200 generic landing page.
        if (src.validateContains?.length) {
          const lc = html.toLowerCase();
          if (!src.validateContains.some((s) => lc.includes(s.toLowerCase()))) continue;
        }
        const got = extractFromPage(html, url, src.label);
        for (const a of got) {
          if (all.length >= limit) break outer;
          all.push(a);
          perSource++;
        }
        await delay(2000); // courtesy rate-limit
      }
      summary[src.label] = perSource;
    }

    console.log("[known_directories] per-source yield:");
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
    console.log(`[known_directories] total before dedupe: ${all.length}`);
    return all.slice(0, limit);
  },
};
