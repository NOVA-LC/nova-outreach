# Cold-email compliance notes

Not legal advice. Quick checklist for the US CAN-SPAM Act + state-of-art
deliverability practice. We comply by design — but read this before changing copy.

## What CAN-SPAM requires

1. **No deceptive subject lines.** Don't promise something the body doesn't deliver.
2. **No deceptive From / Reply-To headers.** Ours: `Tyler <tyler@gonenova.com>`, both real.
3. **Identification as commercial.** Implicit when the body is a sales pitch. We don't pretend it's transactional.
4. **A valid physical postal address.** Set in `COMPLIANCE_ADDRESS` env var; rendered into every email footer.
5. **A working unsubscribe mechanism.** `/api/u/<token>` GET (link) + POST (Gmail one-click). Unsubs honored within 10 days (we honor immediately).
6. **No unsubscribe-as-trap.** No login required to unsubscribe. ✓

## What we add for deliverability (not legally required, just smart)

- **List-Unsubscribe** header with both `mailto:` and `https://` options.
- **List-Unsubscribe-Post: List-Unsubscribe=One-Click** so Gmail surfaces the unsubscribe button in the inbox UI. Recipients use that instead of "Mark as spam" — *huge* deliverability win.
- **Plain text alternative** body for clients that prefer it.
- **No images, no tracking pixels in the visible body.** Only the click-through link is tracked. (Resend's webhook events for opens still work via their pixel; that's invisible to recipients.)
- **Personal-from-real-human** framing — not branded "Nova Intel <noreply@>". Higher reply rates, lower spam-flag rates.
- **Subject line bank** rotated per-recipient to avoid sending identical strings to many addresses (a spam-filter signal).

## Things to NOT change without thinking

- The footer always shows the physical address and unsubscribe link. Both are required.
- Don't use ALL CAPS in subject lines. Spam-filter trigger.
- Don't add `$$$`, `!!!`, "FREE!", "ACT NOW". Trigger words.
- Don't attach files. Spam-filter trigger.
- Don't mass-send identical bodies to 100+ at once — vary copy via the personalization helpers.

## State laws

A few states have stricter rules (CA, FL, NY). The rules above are stricter
than CAN-SPAM and generally satisfy state laws too. Two state-specific notes:
- **California (CCPA/CPRA)**: technically applies to consumer data, not B2B. We're emailing licensed professionals in their professional capacity. Likely outside scope.
- **Florida**: state DOI license registry data is restricted "for personal use only, not for solicitation". If the source of an email was the FL DOI registry, the safer move is to drop FL agents from that source. Our scraper framework should set a flag; the AIL/Globe filter handles it via `excluded_reason='manual'` if added.

## Suppression

Permanent: every unsubscribe → row in `outreach.suppressions`. The send-batch
job filters against this table before sending. Hard bounces and complaints
also auto-suppress.
