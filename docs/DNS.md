# DNS records for Resend on gonenova.com

When you add `gonenova.com` to Resend, it shows you three records. Add them
to your gonenova.com DNS provider. **Do not delete or change** any existing
MX records — those are what receive your real mail. We're only adding TXT.

## What you'll add (Resend will show exact values; here's what they are)

### 1. SPF (TXT) — at the apex
- Host: `@` (or empty / `gonenova.com`)
- Type: TXT
- Value: includes Resend's send IPs alongside whatever was already there

**Critical:** if you already have an SPF record (e.g., `v=spf1 include:_spf.google.com ~all`), do NOT add a second SPF record. Domains can only have ONE SPF. Edit the existing record to include Resend:

```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```
(Resend uses Amazon SES underneath, so `include:amazonses.com` is the entry. Resend's dashboard will tell you the exact include string to use.)

### 2. DKIM (TXT) — at a Resend-specific subdomain
- Host: something like `resend._domainkey`
- Type: TXT
- Value: a long public-key string Resend gives you

This authenticates that emails actually came from your account.

### 3. DMARC (TXT) — at `_dmarc`
- Host: `_dmarc`
- Type: TXT
- Value: `v=DMARC1; p=none; rua=mailto:dmarc@gonenova.com; pct=100;`

Start with `p=none` (monitor only). After a week of clean sends, raise to `p=quarantine` then `p=reject` for stricter reputation protection.

## Verification

In Resend's domain page, click "Verify". DNS propagation usually takes 5-15 min but can be up to 48hrs. If verification fails:
1. Check the record on a public DNS lookup (https://mxtoolbox.com/SuperTool.aspx)
2. Confirm you didn't add a wrapping `"..."` that some DNS UIs require literally
3. Confirm SPF is a single record (most common failure mode)

## Why we're using `gonenova.com` (root) and not `mail.gonenova.com` (subdomain)

Tradeoff:
- **Root domain (gonenova.com)** — leverages your already-warmed sending reputation from `tyler@gonenova.com`. Better day-1 deliverability. Risk: cold campaign complaints affect your personal mail.
- **Subdomain (mail.gonenova.com)** — cold start reputation, slower to warm. Insulates personal mail.

Tonight: root for warmth. After 2 weeks of clean sending, switch to subdomain for scaling.
