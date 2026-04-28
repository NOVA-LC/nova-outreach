export interface ScrapedAgent {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  phone?: string | null;
  brokerage?: string | null;
  agency?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  carriers?: string[] | null;
  source_url?: string | null;
  raw_payload?: any;
}

export interface Scraper {
  name: string;
  source: string;
  /**
   * Pulls a fresh batch of agents. Idempotent — safe to re-run; dedup happens at insert time.
   * `limit` is a soft cap for friendly behavior on the target site.
   */
  scrape: (limit?: number) => Promise<ScrapedAgent[]>;
}
