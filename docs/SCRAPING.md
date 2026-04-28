# Scraping strategy — autonomous daily fresh leads

## What's wired up

Three layers, in order of reliability:

1. **CSV import** (`scripts/import-csv.ts`) — manual, 100% reliable. Drop a CSV, it dedupes + verifies.
2. **Known directories** (`lib/scrapers/known_directories.ts`) — config-driven list of public agent directories. Scrapes `mailto:` and `tel:` links. **Source list starts empty — Tyler curates it.**
3. **Brave Search discovery** (`lib/scrapers/discover.ts`) — search-based autonomous discovery. Runs daily, rotates through 18 states + 4 query templates, fetches top results, extracts emails from agent personal sites. Requires `BRAVE_SEARCH_API_KEY` env var.

The Vercel cron at `0 6 * * *` (06:00 UTC = 02:00 ET) runs both scrapers each day.

## The verification gate

Every email — whether from CSV, scraped, or otherwise — goes through:

1. **Syntax check** — RFC-ish regex
2. **Disposable domain blocklist** — mailinator, tempmail, yopmail, etc. Easy to extend.
3. **MX record lookup** — DNS query to confirm the domain accepts mail. Cached 24h.

Failures get `excluded=true, excluded_reason='invalid_email_<why>'`. They stay
in the DB for audit but never get emailed.

A **last-chance verification** runs in `send-batch` immediately before each
individual send — covers cases where MX records changed since import or
TTL expired.

## What this DOES NOT verify (free tier limits)

- **Mailbox actually exists** on the domain. Requires SMTP-probe; Vercel can't easily do it; many providers ban probing IPs. Hard bounces from non-existent mailboxes will trickle in via the Resend webhook → auto-suppress.
- **Catch-all detection.** Some domains accept anything; we can't tell.

If hard-bounce rate exceeds ~3% over 100+ sends, **integrate ZeroBounce**:

```ts
// lib/email/verify.ts — replace the implementation
const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${KEY}&email=${email}`);
const d = await r.json();
return { ok: d.status === "valid", reason: d.status };
```

Pricing: $5 per 1000 verifications. At 100 emails/day = $0.50/day = $15/mo.

## Brave Search setup (autonomous daily)

1. https://api.search.brave.com/app/keys → create a free account → "Free" plan
2. Copy the API key
3. Vercel env vars → set `BRAVE_SEARCH_API_KEY` → redeploy
4. The next cron run (or hit `/api/cron/scrape` manually) will discover & insert

Free tier: 2,000 queries/month. The discover scraper uses ~12 queries/day = 360/month. Well under.

## Curating known_directories

Open `lib/scrapers/known_directories.ts`. Add to the `SOURCES` array:

```ts
{ url: "https://www.naifa.org/find-an-advisor?state=GA&page=1", label: "naifa_ga" },
{ url: "https://www.tdiagent.com/agents", label: "tdi_texas" },
```

Test each URL: hit it in your browser, view source, look for `mailto:` and `tel:`
links inside the agent listing markup. If they're present in the HTML (not
JS-injected), the scraper will pick them up. If they're JS-rendered, you'll
need a Playwright-based scraper — not worth it for free; use Brave discovery instead.

## When to upgrade to Apollo.io

If you need >500 fresh agents/day or want filterable searches by title/seniority/headcount,
sign up for Apollo.io ($39/mo for 1,000 monthly contacts). I'd add the integration
in `lib/scrapers/apollo.ts`. For now Brave + curated directories should be enough
for the first month of campaign.
