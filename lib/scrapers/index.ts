// Scraper registry. Add new sources here.
import type { Scraper } from "./types";
import { discoverScraper } from "./discover";
import { knownDirectoriesScraper } from "./known_directories";
import { outscraperScraper } from "./outscraper";

export const SCRAPERS: Scraper[] = [
  outscraperScraper,        // best yield (paid; ~$2-5/100 agents)
  knownDirectoriesScraper,  // free, IMO public rosters
  discoverScraper,          // free-ish (Brave Search 2k/mo), broad discovery
];

export function findScraper(name: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.name === name || s.source === name);
}
