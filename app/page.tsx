// Minimal dashboard — intentionally tiny. Reads from outreach.daily_funnel.
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sb = db();
  const { data: rows } = await sb.from("daily_funnel").select("*").limit(14);
  const { data: meterEmail } = await sb.from("send_meter").select("*").eq("channel", "email").order("date", { ascending: false }).limit(7);
  const { data: agentCount } = await sb.from("agents").select("id", { count: "exact", head: true }).eq("excluded", false);

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Nova Outreach</h1>
      <p style={{ color: "#9ca3af" }}>Daily funnel — last 14 days.</p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#9ca3af", borderBottom: "1px solid #1f2937" }}>
            <th>Day</th><th>Campaign</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Bounced</th><th>Complained</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r: any, i: number) => (
            <tr key={i} style={{ borderBottom: "1px solid #1f2937" }}>
              <td>{String(r.day).slice(0, 10)}</td>
              <td>{r.campaign}</td>
              <td>{r.sent}</td>
              <td>{r.delivered}</td>
              <td>{r.opened}</td>
              <td>{r.clicked}</td>
              <td>{r.bounced}</td>
              <td>{r.complained}</td>
            </tr>
          ))}
          {(!rows || rows.length === 0) && (
            <tr><td colSpan={8} style={{ padding: 16, color: "#9ca3af" }}>No sends yet.</td></tr>
          )}
        </tbody>
      </table>

      <p style={{ marginTop: 32, color: "#9ca3af" }}>
        Eligible agents in queue: <b style={{ color: "#fff" }}>{(agentCount as any)?.count ?? "n/a"}</b>
      </p>
    </main>
  );
}
