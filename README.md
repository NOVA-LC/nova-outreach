# nova-outreach

Cold email + (manual-tap) SMS to life-insurance agents, promoting the free
call analyzer at https://novaintel.io/free-analysis. Hosted on Vercel,
data in Supabase (`outreach.*` schema), email via Resend, SMS via Tyler's
Samsung phone (web-launcher pre-fills each message; he taps send).

## What's here

```
app/
  api/
    cron/send-batch/      Vercel cron, sends N emails per run
    cron/scrape/          Vercel cron, daily scraper run
    webhook/resend/       Resend opens/clicks/bounces/complaints
    t/[token]/            Tracking redirect → novaintel.io/free-analysis?utm_*
    u/[token]/            Unsubscribe (GET + Gmail one-click POST)
    sms/queue/            Returns next 10 un-texted agents
    sms/mark-sent/        Marks a manual SMS as sent
    health/               Liveness probe
  sms/                    Mobile-first SMS launcher page
  page.tsx                Daily-funnel dashboard

lib/
  supabase.ts             Service-role server clients (outreach + public schema)
  resend.ts               Resend send wrapper with List-Unsubscribe headers
  env.ts                  Type-safe env access
  email/
    render.ts             HTML + text email body, per-recipient personalization
    subjects.ts           Subject line bank (round-robin per send id)
  sms/render.ts           SMS body, ≤160 chars w/ STOP opt-out
  filters/exclude.ts      AIL / Globe Life / Liberty National filter
  scrapers/               Pluggable scrapers (one stub, more to add)

scripts/
  import-csv.ts           Bulk-load agents from a CSV (works around scraper churn)

docs/
  DEPLOY.md               One-shot deploy steps
  DNS.md                  SPF/DKIM/DMARC records for gonenova.com in Resend
  10DLC.md                SMS legal/operational playbook (file before you scale)
  COLD_EMAIL_LAW.md       CAN-SPAM compliance notes for the cold email
```

## Day-1 plan

1. Resend → verify `gonenova.com` (DNS records in `docs/DNS.md`)
2. Vercel → import this repo, set env vars (see `.env.local.example`)
3. Supabase → schema is already migrated; campaigns are pre-loaded
4. `npx tsx scripts/import-csv.ts ./agents.csv hand_collected` to seed agents
5. First Vercel cron run sends up to 6 emails; ramps to 100/day cap

## Warmup ramp (override DAILY_SEND_CAP)

| Day  | Cap   | Notes                                                                  |
|------|-------|------------------------------------------------------------------------|
| 1    | 100   | tyler@gonenova.com is a warmed inbox; safer to start at 100 than 30    |
| 2    | 150   | bump if no bounces/complaints                                          |
| 3-7  | 200   | watch open rate; <8% = pause, fix copy                                 |
| 8-14 | 300   | switch to mail.gonenova.com subdomain to isolate reputation            |
| 15+  | 500   | stable                                                                 |

## Conversion tracking

Tracking links carry `utm_source=cold_email&utm_campaign=<id>&utm_content=<token>`.
The `outreach.conversions` view joins our sends to `public.free_analysis_results`
on email — once a recipient drops their email at the free-analysis paywall, we
can attribute the conversion to the specific send that brought them in.
