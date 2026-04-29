#!/usr/bin/env tsx
/**
 * Direct-Postgres CLI sender.
 *
 * Reads/writes Supabase via the `pg` driver — no PostgREST in the path.
 * That removes an entire class of failures (schema cache, exposed-schemas,
 * RLS, "Accept-Profile", etc).
 *
 * Env required:
 *   DATABASE_URL                Postgres connection string (Supabase Transaction Pooler URI)
 *   RESEND_API_KEY              Resend API key
 *   APP_URL                     Public URL used for tracking + unsubscribe links
 *   FROM_EMAIL, FROM_NAME, REPLY_TO
 *   COMPLIANCE_ADDRESS          Physical address for CAN-SPAM footer
 *   DAILY_SEND_CAP, PER_RUN_CAP
 *
 * Flags:
 *   --limit N    override PER_RUN_CAP for this run
 *   --dry        render but don't actually send
 */
import { Client } from "pg";
import { Resend } from "resend";
import { renderHtml, renderText } from "../lib/email/render";
import { pickSubject } from "../lib/email/subjects";
import { verifyEmail } from "../lib/email/verify";

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

const DATABASE_URL = envOrDie("DATABASE_URL");
const RESEND_API_KEY = envOrDie("RESEND_API_KEY");
const APP_URL = envOrDie("APP_URL");
const FROM_EMAIL = envOrDie("FROM_EMAIL");
const FROM_NAME = process.env.FROM_NAME ?? "Tyler";
const REPLY_TO = process.env.REPLY_TO ?? FROM_EMAIL;
const DAILY_SEND_CAP = parseInt(process.env.DAILY_SEND_CAP ?? "100", 10);
let PER_RUN_CAP = parseInt(process.env.PER_RUN_CAP ?? "6", 10);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitFlagIdx = args.indexOf("--limit");
if (limitFlagIdx !== -1) PER_RUN_CAP = parseInt(args[limitFlagIdx + 1] ?? "6", 10);

const resend = new Resend(RESEND_API_KEY);

async function main() {
  const sb = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await sb.connect();
  console.log("[boot] connected to Postgres directly");

  try {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Today's send count.
    const meterResult = await sb.query<{ sent: number }>(
      `SELECT sent FROM public.outreach_send_meter WHERE date = $1 AND channel = 'email'`,
      [today],
    );
    const sentToday = meterResult.rows[0]?.sent ?? 0;
    const remainingToday = DAILY_SEND_CAP - sentToday;
    if (remainingToday <= 0) {
      console.log(`Daily cap hit (${sentToday}/${DAILY_SEND_CAP}). Exiting.`);
      return;
    }
    const batchSize = Math.min(PER_RUN_CAP, remainingToday);

    // 2. Active campaign.
    const campResult = await sb.query<{
      id: string; name: string; channel: string;
    }>(
      `SELECT id, name, channel FROM public.outreach_campaigns
       WHERE active = true AND channel = 'email'
       ORDER BY created_at DESC LIMIT 1`,
    );
    const campaign = campResult.rows[0];
    if (!campaign) {
      console.error("No active email campaign in public.outreach_campaigns. Insert one first.");
      process.exit(1);
    }
    console.log(`[campaign] ${campaign.name} (${campaign.id})`);

    // 3. Eligible candidates: not excluded, not unsubscribed, not bounced,
    //    not in suppressions, no existing send for this campaign.
    const candResult = await sb.query<{
      id: string; email: string; first_name: string | null; brokerage: string | null; state: string | null;
    }>(
      `
      SELECT a.id, a.email, a.first_name, a.brokerage, a.state
      FROM public.outreach_agents a
      WHERE a.excluded = false
        AND a.unsubscribed_at IS NULL
        AND a.hard_bounced_at IS NULL
        AND a.complained_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.outreach_sends s
          WHERE s.agent_id = a.id AND s.campaign_id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.outreach_suppressions sup
          WHERE sup.email_normalized = a.email_normalized
        )
      ORDER BY a.scraped_at ASC
      LIMIT $2
      `,
      [campaign.id, batchSize],
    );
    const candidates = candResult.rows;
    console.log(`[candidates] ${candidates.length} (cap ${batchSize})`);

    if (candidates.length === 0) {
      console.log("No eligible agents. Either queue is empty or everyone has been emailed.");
      return;
    }

    let sent = 0;
    for (const agent of candidates) {
      // Last-chance email verification (DNS MX).
      const v = await verifyEmail(agent.email);
      if (!v.ok) {
        console.log(`SKIP ${agent.email}: verify_failed:${v.reason}`);
        await sb.query(
          `UPDATE public.outreach_agents SET excluded = true, excluded_reason = $2 WHERE id = $1`,
          [agent.id, `invalid_email_${v.reason}`],
        );
        continue;
      }

      // Insert send row, get track_token.
      const insResult = await sb.query<{ id: string; track_token: string }>(
        `INSERT INTO public.outreach_sends (agent_id, campaign_id, channel, status)
         VALUES ($1, $2, 'email', 'queued')
         RETURNING id, track_token`,
        [agent.id, campaign.id],
      );
      const sendRow = insResult.rows[0];

      const trackUrl = `${APP_URL}/api/t/${sendRow.track_token}`;
      const unsubUrl = `${APP_URL}/api/u/${sendRow.track_token}`;
      const html = renderHtml({
        firstName: agent.first_name,
        brokerage: agent.brokerage,
        state: agent.state,
        trackUrl, unsubUrl,
      });
      const text = renderText({
        firstName: agent.first_name,
        brokerage: agent.brokerage,
        state: agent.state,
        trackUrl, unsubUrl,
      });
      const subject = pickSubject(sendRow.id);

      if (DRY) {
        console.log(`[DRY] ${agent.email} :: ${subject}\n${text}\n---`);
        await sb.query(
          `UPDATE public.outreach_sends SET status = 'failed', error = 'dry_run' WHERE id = $1`,
          [sendRow.id],
        );
        continue;
      }

      try {
        const result = await resend.emails.send({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [agent.email],
          subject,
          html,
          text,
          replyTo: REPLY_TO,
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>, <mailto:${REPLY_TO}?subject=unsubscribe>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "campaign", value: campaign.id.slice(0, 8) },
            { name: "track", value: sendRow.track_token },
          ],
        });
        if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error));
        const messageId = result.data?.id;

        await sb.query(
          `UPDATE public.outreach_sends
           SET provider_message_id = $2, status = 'sent', sent_at = now()
           WHERE id = $1`,
          [sendRow.id, messageId],
        );
        console.log(`SENT ${agent.email} (${messageId})`);
        sent++;
      } catch (e: any) {
        console.error(`FAIL ${agent.email}: ${e.message}`);
        await sb.query(
          `UPDATE public.outreach_sends SET status = 'failed', error = $2 WHERE id = $1`,
          [sendRow.id, e.message ?? String(e)],
        );
      }
    }

    if (sent > 0 && !DRY) {
      await sb.query(
        `INSERT INTO public.outreach_send_meter (date, channel, sent)
         VALUES ($1, 'email', $2)
         ON CONFLICT (date, channel) DO UPDATE SET sent = public.outreach_send_meter.sent + EXCLUDED.sent`,
        [today, sent],
      );
    }
    console.log(`Sent ${sent}. Today total: ${sentToday + sent}/${DAILY_SEND_CAP}`);
  } finally {
    await sb.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
