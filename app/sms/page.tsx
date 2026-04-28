// Mobile-first SMS launcher.
// Flow:
//   1. Tyler opens https://app/sms?key=<SCRAPE_SECRET> on his Samsung
//   2. Page fetches a queue of 10 un-texted agents
//   3. Big SEND button → fires sms:+phone?body=msg → Samsung Messages opens pre-filled
//   4. Tyler taps send IN Messages app, swipes back
//   5. Tyler taps "Mark sent" (or "Skip"); page advances to next
//
// Only state lives in localStorage (the queue) and Supabase (sends rows).
"use client";

import { useEffect, useState } from "react";

interface QueueItem {
  send_id: string;
  track_token: string;
  first_name: string | null;
  full_name: string | null;
  brokerage: string | null;
  state: string | null;
  phone: string;
  body: string;
}

export default function SmsLauncher() {
  const [key, setKey] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentToday, setSentToday] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const k = u.searchParams.get("key");
    if (k) setKey(k);
    const todayKey = "nova_sms_sent_" + new Date().toISOString().slice(0, 10);
    setSentToday(parseInt(localStorage.getItem(todayKey) ?? "0", 10));
  }, []);

  useEffect(() => {
    if (!key) return;
    fetchQueue(key);
  }, [key]);

  async function fetchQueue(k: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sms/queue?key=${encodeURIComponent(k)}&take=10`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "failed");
      setQueue(data.queue ?? []);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function markSent(send_id: string, action: "sent" | "skip") {
    if (!key) return;
    await fetch(`/api/sms/mark-sent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ send_id, action }),
    });
    setQueue((q) => q.slice(1));
    if (action === "sent") {
      const todayKey = "nova_sms_sent_" + new Date().toISOString().slice(0, 10);
      const next = sentToday + 1;
      localStorage.setItem(todayKey, String(next));
      setSentToday(next);
    }
    if (queue.length <= 1 && key) {
      // Refill when queue runs low.
      fetchQueue(key);
    }
  }

  if (!key) {
    return (
      <main style={{ padding: 24, maxWidth: 540, margin: "0 auto" }}>
        <h1>Nova SMS Launcher</h1>
        <p>Open this link from the email I sent you. It needs a <code>?key=</code> in the URL.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Error</h1>
        <p style={{ color: "#ef4444" }}>{error}</p>
        <button onClick={() => key && fetchQueue(key)}>Retry</button>
      </main>
    );
  }

  const current = queue[0];

  return (
    <main style={{ padding: 16, maxWidth: 540, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>SMS Launcher</h1>
        <span style={{ color: "#9ca3af", fontSize: 14 }}>
          Sent today: <b style={{ color: "#22d3ee" }}>{sentToday}</b>
        </span>
      </header>

      {loading && <p>Loading queue…</p>}

      {!loading && !current && (
        <div style={{ marginTop: 32 }}>
          <p>Queue empty. Either you're done for now, or all agents have been texted in this campaign.</p>
          <button onClick={() => key && fetchQueue(key)} style={btn()}>Refresh queue</button>
        </div>
      )}

      {current && (
        <>
          <section style={{ background: "#111827", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {current.full_name || current.first_name || "(no name)"}
            </p>
            <p style={{ margin: "4px 0 0 0", color: "#9ca3af", fontSize: 14 }}>
              {[current.brokerage, current.state].filter(Boolean).join(" · ") || " "}
            </p>
            <p style={{ margin: "12px 0 0 0", fontSize: 14, color: "#cbd5e1" }}>
              <b>{current.phone}</b>
            </p>
          </section>

          <section style={{ background: "#0f172a", borderRadius: 12, padding: 16, marginBottom: 24, border: "1px solid #1e293b" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Message preview</p>
            <p style={{ margin: "8px 0 0 0", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{current.body}</p>
          </section>

          <a
            href={`sms:${current.phone}?body=${encodeURIComponent(current.body)}`}
            onClick={() => {
              // Mark sent immediately. If Tyler bails out before tapping send in Messages,
              // the agent won't be re-queued (acceptable cost — it's rare and we'd rather
              // never double-text than re-queue).
              setTimeout(() => markSent(current.send_id, "sent"), 250);
            }}
            style={{
              display: "block",
              textAlign: "center",
              background: "#22d3ee",
              color: "#0b0d12",
              fontWeight: 700,
              fontSize: 24,
              padding: "20px 24px",
              borderRadius: 16,
              textDecoration: "none",
              marginBottom: 12,
            }}
          >
            Open Messages →
          </a>

          <button onClick={() => markSent(current.send_id, "skip")} style={btn("ghost")}>
            Skip this one
          </button>

          <p style={{ marginTop: 24, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            Tap the big button → Samsung Messages opens with the message pre-filled.
            Tap send inside Messages, then swipe back here. Next recipient will be ready.
          </p>
          <p style={{ fontSize: 12, color: "#64748b" }}>
            Queue depth: {queue.length}
          </p>
        </>
      )}
    </main>
  );
}

function btn(variant: "primary" | "ghost" = "primary") {
  if (variant === "ghost") {
    return {
      display: "block",
      width: "100%",
      background: "transparent",
      color: "#9ca3af",
      border: "1px solid #374151",
      padding: "12px 16px",
      borderRadius: 12,
      fontSize: 16,
      cursor: "pointer",
    } as const;
  }
  return {
    display: "block",
    width: "100%",
    background: "#22d3ee",
    color: "#0b0d12",
    border: "none",
    padding: "16px 20px",
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
  } as const;
}
