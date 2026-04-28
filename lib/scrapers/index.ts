// Scraper registry. Add new sources here.
import type { Scraper } from "./types";
import { discoverScraper } from "./discover";
import { knownDirectoriesScraper } from "./known_directories";

export const SCRAPERS: Scraper[] = [
  discoverScraper,
  knownDirectoriesScraper,
];

export function findScraper(name: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.name === name || s.source === name);
}
