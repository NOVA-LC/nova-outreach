// Config-driven scraper for known public agent directories.
// Add URLs here as you find directories that work. The scraper visits each,
// extracts emails + phones via mailto/tel links, and assigns the directory's
// label as `source`.
//
// Format:
//   { url: "...", label: "naifa", maxAgentsPerPage: 50 }
//
// Throughput: 1 page per 2 seconds (rate-limited). 50 pages = 100 seconds —
// fits Vercel's 60s function limit if pages are <=30 per run; for bigger runs,
// trigger via /api/cron/scrape multiple times across the day.

import * as cheerio from "cheerio";
import type { Scraper, ScrapedAgent } from "./types";

const UA = "NovaIntelOutreachBot/0.1 (+https://novaintel.io; tyler@gonenova.com)";

interface Source {
  url: string;
  label: string;
  selector?: string;       // CSS for individual agent cards
  pages?: string[];        // optional pagination URLs
}

// PLACEHOLDER. Tyler should curate this list — some examples to start with.
// Test each one with the standalone runner before relying on it.
const SOURCES: Source[] = [
  // { url: "https://www.naifa.org/find-an-advisor", label: "naifa" },
  // { url: "https://www.nailba.org/broker-directory", label: "nailba" },
];

async function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function scrapePage(src: Source): Promise<ScrapedAgent[]> {
  let html = "";
  try {
    const res = await fetch(src.url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const out: ScrapedAgent[] = [];
  const seen = new Set<string>();

  const cards = src.selector ? $(src.selector) : $("body");
  cards.each((_, el) => {
    const $el = $(el);
    const blocks = src.selector
      ? [$el]
      : $el.find("[itemtype*='Person'], .agent, .agent-card, .listing, article").toArray().map(($e) => $($e));
    if (blocks.length === 0) blocks.push($el);

    for (const $b of blocks) {
      const name = $b.find("[itemprop='name'], h2, h3, .name, .agent-name").first().text().trim();
      const email = $b.find("a[href^='mailto:']").attr("href")?.replace(/^mailto:/, "").split("?")[0].trim().toLowerCase();
      const phone = $b.find("a[href^='tel:']").attr("href")?.replace(/^tel:/, "").trim();
      const brokerage = $b.find("[itemprop='worksFor'], .company, .brokerage, .firm").first().text().trim();
      const city = $b.find("[itemprop='addressLocality'], .city, .location").first().text().trim();
      const state = $b.find("[itemprop='addressRegion'], .state").first().text().trim();

      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({
        email,
        full_name: name || null,
        phone: phone || null,
        brokerage: brokerage || null,
        city: city || null,
        state: state || null,
        source_url: src.url,
        raw_payload: { source: src.label },
      });
    }
  });

  return out;
}

export const knownDirectoriesScraper: Scraper = {
  name: "known_directories",
  source: "known_directories",
  scrape: async (limit = 200) => {
    const all: ScrapedAgent[] = [];
    for (const src of SOURCES) {
      try {
        const got = await scrapePage(src);
        all.push(...got);
        if (all.length >= limit) break;
      } catch (e) {
        console.warn("known dir scrape failed", src.url, e);
      }
      await delay(2000);
    }
    return all.slice(0, limit);
  },
};
