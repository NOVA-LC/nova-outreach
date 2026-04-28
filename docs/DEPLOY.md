# Deploy guide

Read this end-to-end before starting. Total time: ~25 minutes.

## 0. Pre-flight

You need:
- The Resend API key (already in env example)
- Supabase service-role key (Project Settings → API → `service_role` secret)
- Access to `gonenova.com` DNS (to add 3 TXT records for Resend)
- A Vercel account with the GitHub repo `NOVA-LC/nova-outreach` connected

## 1. Vercel — import the repo

1. https://vercel.com/new → "Import Git Repository" → pick `NOVA-LC/nova-outreach`
2. Framework: Next.js (auto-detected). Build command: default. Root: `./`
3. **Stop before clicking Deploy.** Click "Environment Variables" first.

## 2. Vercel — env vars

Paste each of these. The ones marked `*` you must fill in yourself.

```
SUPABASE_URL                = https://sqsaixsqxavcfklovkbw.supabase.co
SUPABASE_SERVICE_ROLE_KEY   = *  (from Supabase dashboard → API → service_role)

RESEND_API_KEY              = re_PezewVYA_FE1Lzeypx3uhwoLt6iqohri8
RESEND_WEBHOOK_SECRET       = *  (set after step 5; leave blank for first deploy)

APP_URL                     = https://nova-outreach.vercel.app
                              (or your custom domain once set)

CRON_SECRET                 = *  (run: openssl rand -hex 24, or any 48-char hex)
SCRAPE_SECRET               = *  (same idea — protects /sms launcher)

FROM_EMAIL                  = tyler@gonenova.com
FROM_NAME                   = Tyler
REPLY_TO                    = tyler@gonenova.com

COMPLIANCE_ADDRESS          = Nova Intel, [STREET], Atlanta, GA [ZIP]

DAILY_SEND_CAP              = 100
PER_RUN_CAP                 = 6
```

Click Deploy. First build takes ~90 seconds.

## 3. Vercel — note the deployed URL

Copy your `*.vercel.app` URL. Update `APP_URL` env var if it differs from
the placeholder above. Redeploy (env changes require redeploy).

## 4. Resend — verify the sender domain

1. https://resend.com/domains → "Add Domain" → enter `gonenova.com` (NOT mail.gonenova.com — we're using the root)
2. Resend shows three DNS records. See `docs/DNS.md` for what each one is.
3. Add all three to your gonenova.com DNS provider (Namecheap/Cloudflare/Google Domains/etc).
4. Click "Verify" in Resend. Wait 5-15 minutes if it fails the first time (DNS propagation).
5. Status should turn green: SPF, DKIM, DMARC all "Verified".

## 5. Resend — webhook for opens/clicks/bounces

1. https://resend.com/webhooks → "Add endpoint"
2. URL: `https://YOUR-VERCEL-URL/api/webhook/resend`
3. Events: select all `email.*` events
4. Copy the signing secret (looks like `whsec_...`)
5. Vercel → Project Settings → Environment Variables → set `RESEND_WEBHOOK_SECRET`
6. Redeploy

## 6. Test send to yourself

```bash
curl -i "https://YOUR-VERCEL-URL/api/cron/send-batch" \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
```

You should get `{"ok":true,"sent":N,...}` BUT this requires agents in the DB.
For an isolated test, insert yourself first:

```sql
-- Run in Supabase SQL editor (with SET search_path or qualify with outreach.)
INSERT INTO outreach.agents (email, first_name, source)
VALUES ('tyler@gonenova.com', 'Tyler', 'self_test');
```

Then trigger the cron. Check `tyler@gonenova.com` inbox.

## 7. Load real agents

Two paths:

**A. CSV upload (recommended for tonight)**
```bash
git clone https://github.com/NOVA-LC/nova-outreach
cd nova-outreach
npm install
cp .env.local.example .env.local
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY at minimum
source .env.local && export $(cut -d= -f1 .env.local)
npx tsx scripts/import-csv.ts ./agents.csv apollo_export
```

**B. Run the scraper** (will likely need selector tweaks first)
```bash
curl "https://YOUR-VERCEL-URL/api/cron/scrape" \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## 8. Open the dashboard

`https://YOUR-VERCEL-URL/` — daily funnel, eligible-agent count.

## 9. Open the SMS launcher (on your Samsung)

`https://YOUR-VERCEL-URL/sms?key=YOUR_SCRAPE_SECRET`

Bookmark it. When 10DLC clears in 1-2 weeks, replace this manual flow with
a cron-triggered Twilio path (skeleton in `docs/10DLC.md`).
