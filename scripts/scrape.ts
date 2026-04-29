#!/usr/bin/env tsx
/**
 * CLI scrape runner. Calls every registered scraper, runs the AIL/Globe filter,
 * and upserts into outreach.agents.
 */
import { createClient } from "@supabase/supabase-js";
import { SCRAPERS } from "../lib/scrapers";
import { classify } from "../lib/filters/exclude";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

const sb = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  for (const scraper of SCRAPERS) {
    console.log(`Running scraper: ${scraper.name}`);
    let agents: any[];
    try {
      agents = await scraper.scrape(200);
    } catch (e: any) {
      console.error(`  failed: ${e.message}`);
      continue;
    }
    console.log(`  found ${agents.length} candidate agents`);
    if (agents.length === 0) continue;

    const records = agents.map((a) => {
      const cls = classify(a);
      return {
        email: a.email,
        first_name: a.first_name ?? null,
        last_name: a.last_name ?? null,
        full_name: a.full_name ?? null,
        phone: a.phone ?? null,
        brokerage: a.brokerage ?? null,
        agency: a.agency ?? null,
        city: a.city ?? null,
        state: a.state ?? null,
        zip: a.zip ?? null,
        carriers: a.carriers ?? null,
        source: scraper.source,
        source_url: a.source_url ?? null,
        raw_payload: a.raw_payload ?? a,
        excluded: cls.excluded,
        excluded_reason: cls.reason ?? null,
      };
    });

    const { error, count } = await sb
      .from("outreach_agents")
      .upsert(records, { onConflict: "email_normalized", ignoreDuplicates: true, count: "exact" });
    if (error) {
      console.error(`  upsert error: ${error.message}`);
    } else {
      console.log(`  upserted ${count ?? records.length} (new only)`);
    }
  }

  const { count: eligible } = await sb
    .from("outreach_agents")
    .select("id", { count: "exact", head: true })
    .eq("excluded", false);
  console.log(`Total eligible agents now: ${eligible}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
