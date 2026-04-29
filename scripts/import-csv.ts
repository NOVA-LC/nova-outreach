#!/usr/bin/env tsx
/**
 * Import a CSV of agents into outreach.agents.
 *
 * Usage:
 *   npx tsx scripts/import-csv.ts ./agents.csv [source_label]
 *
 * The CSV must have a header row. Recognized columns (case-insensitive):
 *   email* (required)
 *   first_name | firstname | first
 *   last_name | lastname | last
 *   full_name | name
 *   phone | phone_number
 *   brokerage | company
 *   agency
 *   city | state | zip
 *   carriers (comma-separated)
 *   source_url | url
 *
 * Runs the AIL/Globe filter and dedupes on email_normalized.
 */
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { classify } from "../lib/filters/exclude";
import { verifyMany } from "../lib/email/verify";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}. Source .env.local first.`);
    process.exit(1);
  }
  return v;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/import-csv.ts <csv> [source_label]");
  process.exit(1);
}
const sourceLabel = process.argv[3] ?? path.basename(file).replace(/\.csv$/i, "");

const SUPABASE_URL = envOrDie("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function pickKey(row: Record<string, any>, candidates: string[]): string | null {
  const lc: Record<string, any> = {};
  for (const k of Object.keys(row)) lc[k.toLowerCase().replace(/\s+/g, "_")] = row[k];
  for (const c of candidates) if (lc[c] != null && String(lc[c]).trim() !== "") return String(lc[c]).trim();
  return null;
}

function normalizePhone(s: string | null): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null; // can't confidently format
}

async function main() {
  const raw = fs.readFileSync(file, "utf8");
  const rows: any[] = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Read ${rows.length} rows from ${file}`);

  // Pre-verify all emails (MX + disposable + syntax) in parallel before insert.
  console.log(`Verifying ${rows.length} emails (MX + disposable + syntax)...`);
  const allEmails = rows.map((r: any) => r.email || r.Email || r.EMAIL || "").filter(Boolean);
  const verifications = await verifyMany(allEmails, 24);
  const verified = [...verifications.values()].filter((v) => v.ok).length;
  console.log(`Verification: ${verified}/${allEmails.length} passed`);

  const records: any[] = [];
  let skippedAIL = 0;
  let skippedNoEmail = 0;
  let skippedInvalid = 0;

  for (const r of rows) {
    const email = pickKey(r, ["email", "email_address"]);
    const firstName = pickKey(r, ["first_name", "firstname", "first"]);
    const lastName = pickKey(r, ["last_name", "lastname", "last"]);
    const fullName = pickKey(r, ["full_name", "name"]) ?? [firstName, lastName].filter(Boolean).join(" ") || null;
    const phone = pickKey(r, ["phone", "phone_number", "mobile", "cell"]);
    const brokerage = pickKey(r, ["brokerage", "company", "agency_name"]);
    const agency = pickKey(r, ["agency"]);
    const city = pickKey(r, ["city"]);
    const state = pickKey(r, ["state", "state_code"]);
    const zip = pickKey(r, ["zip", "postal_code", "zip_code"]);
    const sourceUrl = pickKey(r, ["source_url", "url"]);
    const carriersStr = pickKey(r, ["carriers", "carrier"]);
    const carriers = carriersStr ? carriersStr.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : null;

    if (!email) {
      skippedNoEmail++;
      continue;
    }

    const cls = classify({
      email,
      brokerage,
      agency,
      full_name: fullName,
      raw_payload: r,
      carriers,
    });
    const v = verifications.get(email.toLowerCase().trim());
    const verifyExcluded = v ? !v.ok : false;
    const excluded = cls.excluded || verifyExcluded;
    const reason =
      cls.reason ?? (verifyExcluded ? `invalid_email_${v!.reason}` : null);

    if (cls.excluded && cls.reason !== "missing_email") skippedAIL++;
    if (verifyExcluded) skippedInvalid++;

    records.push({
      email,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone,
      phone_normalized: normalizePhone(phone),
      brokerage,
      agency,
      city,
      state: state?.toUpperCase().slice(0, 2) ?? null,
      zip,
      source: sourceLabel,
      source_url: sourceUrl,
      carriers,
      excluded,
      excluded_reason: reason,
      raw_payload: r,
    });
  }

  console.log(
    `Prepared ${records.length} records (skipped ${skippedNoEmail} missing-email, ${skippedAIL} carrier-filtered, ${skippedInvalid} email-verification-failed)`,
  );

  // Upsert in batches of 500 on email_normalized.
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error, count } = await sb
      .from("outreach_agents")
      .upsert(batch, { onConflict: "email_normalized", ignoreDuplicates: true, count: "exact" });
    if (error) {
      console.error("Batch insert error:", error.message);
      process.exit(1);
    }
    inserted += count ?? batch.length;
    process.stdout.write(`.`);
  }
  console.log(`\nInserted/updated ${inserted}.`);

  const { count: totalEligible } = await sb
    .from("outreach_agents")
    .select("id", { count: "exact", head: true })
    .eq("excluded", false);
  console.log(`Total eligible agents in DB: ${totalEligible}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
