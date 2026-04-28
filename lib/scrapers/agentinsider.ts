// Scraper for a public agent directory site.
//
// IMPORTANT: this is a sketch — directory site HTML changes constantly. Treat the
// selectors below as a starting point, NOT a guaranteed-working scraper. The first
// time you run /api/cron/scrape you'll likely get 0 results and need to inspect the
// site's HTML to update selectors.
//
// For tonight, the reliable path to first send is: scripts/import-csv.ts.
//
// Robots-friendly: rate-limited to 1 req/2s, identifies itself in UA.
import * as cheerio from "cheerio";
import type { Scraper, ScrapedAgent } from "./types";

const UA = "NovaIntelOutreachBot/0.1 (+https://novaintel.io; tyler@gonenova.com)";

async function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

// EXAMPLE selectors — you'll need to update once you see real HTML.
async function scrapeListing(url: string): Promise<ScrapedAgent[]> {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const out: ScrapedAgent[] = [];

  $(".agent-card, .agent-listing, [data-agent]").each((_, el) => {
    const $el = $(el);
    const name = $el.find(".agent-name, h3, h4").first().text().trim();
    const email = $el.find("a[href^='mailto:']").attr("href")?.replace("mailto:", "").trim();
    const phone = $el.find("a[href^='tel:']").attr("href")?.replace("tel:", "").trim();
    const brokerage = $el.find(".brokerage, .company").first().text().trim();
    const city = $el.find(".city, .location").first().text().trim();

    if (!email) return;
    out.push({
      email,
      full_name: name || null,
      phone: phone || null,
      brokerage: brokerage || null,
      city: city || null,
      source_url: url,
    });
  });

  return out;
}

export const ftcScraperHonorRobots: Scraper = {
  name: "agentinsider",
  source: "agentinsider",
  scrape: async (limit = 100) => {
    // PLACEHOLDER seed list — replace with actual paginated index pages of the target site.
    const seeds = [
      "https://example.invalid/agents/page/1",
    ];
    const all: ScrapedAgent[] = [];
    for (const u of seeds) {
      try {
        const batch = await scrapeListing(u);
        all.push(...batch);
        if (all.length >= limit) break;
      } catch (e) {
        console.warn("scrape failed for", u, e);
      }
      await delay(2000);
    }
    return all.slice(0, limit);
  },
};
