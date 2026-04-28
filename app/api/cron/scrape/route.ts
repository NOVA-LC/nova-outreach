// Cron-triggered scraper. Runs registered scrapers, runs AIL/Globe filter, upserts agents.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { SCRAPERS } from "@/lib/scrapers";
import { classify } from "@/lib/filters/exclude";
import { verifyMany } from "@/lib/email/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(req: NextRequest): boolean {
  const a = req.headers.get("authorization") ?? "";
  return a === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const sb = db();
  const results: any[] = [];

  for (const scraper of SCRAPERS) {
    try {
      const agents = await scraper.scrape(200);

      // Verify emails (MX + disposable + syntax). Anything that fails gets
      // excluded=true so it's filtered from sends but kept for audit.
      const verifications = await verifyMany(agents.map((a) => a.email), 16);

      const records = agents.map((a) => {
        const carrierCls = classify(a);
        const v = verifications.get(a.email.toLowerCase().trim());
        // Combine carrier exclusion with email-verification exclusion.
        const excluded = carrierCls.excluded || (v ? !v.ok : false);
        const reason =
          carrierCls.reason ?? (v && !v.ok ? `invalid_email_${v.reason}` : null);
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
          excluded,
          excluded_reason: reason as any,
        };
      });
      if (records.length > 0) {
        const { error, count } = await sb
          .from("agents")
          .upsert(records, { onConflict: "email_normalized", ignoreDuplicates: true, count: "exact" });
        results.push({ scraper: scraper.name, found: agents.length, inserted: count ?? 0, error: error?.message });
      } else {
        results.push({ scraper: scraper.name, found: 0, inserted: 0 });
      }
    } catch (e: any) {
      results.push({ scraper: scraper.name, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
