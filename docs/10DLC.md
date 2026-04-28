# SMS playbook — 10DLC and the path to automated bulk

## TL;DR

You can't legally and reliably blast 1,000+ SMS to US cell phones without
**10DLC** (10-Digit Long Code) registration. Plan on 1–3 weeks for approval
and ~$15 setup + $1.50/mo. Until then, the Android web launcher at `/sms`
gives you a manual-tap path that's TCPA-defensible (you tap each send) and
not subject to carrier filtering (the texts come from your real phone).

## The legal landscape (one paragraph)

The TCPA (Telephone Consumer Protection Act) governs SMS to cell phones.
"Marketing" SMS to consumer numbers requires **prior express written consent**.
Statutory damages: $500–$1,500 per text. Class actions are aggressive.
B2B-to-licensed-professional SMS is a softer area but not zero-risk; courts
have ruled both ways. The safest defensive posture is: (a) opt-out language
in every message ("Reply STOP"), (b) suppress STOP replies immediately, (c)
record the agent's licensed status in your records as the "established business
relationship" basis, (d) don't text the same person twice if they don't reply.

## The carrier landscape (the practical blocker)

T-Mobile, Verizon, and AT&T jointly require **10DLC registration** for any
business-grade SMS. Without it, your throughput is throttled to ~1 msg/min and
~80% of messages are filtered. Even with consent, unregistered SMS won't land.

10DLC has two pieces:
1. **Brand registration** with The Campaign Registry (TCR). Tells carriers who you are. ~$4 setup.
2. **Campaign registration**. Describes what you'll send. ~$10/mo (varies by use case). Approval: 1-21 days.

## Twilio-specific 10DLC steps

1. https://console.twilio.com → Messaging → Regulatory Compliance → "Register a Brand"
2. Fill out: legal entity name, EIN, business address, vertical (Insurance), website (novaintel.io)
3. Submit. Vetting score returns in ~30 minutes.
4. Create a **Messaging Service** in Twilio (a logical group of numbers).
5. Buy a 10DLC number (~$1/mo) and assign it to the Messaging Service.
6. Register a **Campaign** under the Messaging Service. Use case: "Marketing - Low Volume" or "Marketing".
7. Provide **sample messages** that match what you'll actually send. Carriers reject if real sends don't match samples.
8. Provide your **opt-in flow** description. For us this is the trickiest part — we don't have classic opt-in. Frame it as: "B2B outreach to publicly-listed licensed insurance agents who have published their phone number on their professional profile. Not consumer marketing."
9. Wait 1-21 days for campaign approval.

## Our automated SMS endpoint (when 10DLC clears)

Add to `lib/twilio.ts`:

```ts
import twilio from "twilio";
import { env } from "./env";

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export async function sendSms(to: string, body: string) {
  const msg = await client.messages.create({
    to,
    from: env.TWILIO_FROM_NUMBER, // or messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID
    body,
  });
  return msg.sid;
}
```

Add a cron-triggered route at `app/api/cron/send-sms-batch/route.ts` that
mirrors `send-batch` but uses the SMS campaign + `sendSms()`. Add to vercel.json:

```json
{ "path": "/api/cron/send-sms-batch", "schedule": "0,30 14-22 * * 1-5" }
```

## Until 10DLC clears

Use `/sms?key=...` on your Samsung. Throughput: ~12-20 sends/minute = 1k in
an hour or two of constant tapping. Texts come from your real phone, so:
- Carriers don't filter (they look like normal personal texts)
- Replies come back to you naturally
- TCPA "manual dialing" exemption is at its strongest
- After ~200-300 sends in a day, your number may get spam-flagged on
  recipient end. Slow down or split across two days.

## Compliance one-liner for the message

Already baked into `lib/sms/render.ts`:

> Hey [name], I built a tool that grades your last life ins call & shows the 3 things to fix. First one's free: [link]  -Tyler. Reply STOP to opt out.

This satisfies most TCPA defensive checkboxes: clear sender ID, business
identifier, opt-out instruction. Don't change without re-checking.
