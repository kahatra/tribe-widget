"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { nanoid } from "nanoid";

type HangRequest = {
  id: string;
  slug: string;
  title: string;
  type: string;
  note: string | null;
  created_at: string;
};

type WindowRow = {
  id: string;
  request_id: string;
  user_key: string;
  user_name: string | null;
  start_ts: string;
  end_ts: string;
  created_at: string;
};

function getUserKey(): string {
  if (typeof window === "undefined") return "server";
  const existing = localStorage.getItem("tw_user_key");
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem("tw_user_key", fresh);
  return fresh;
}
function getUserName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tw_user_name") || "";
}
function setUserName(name: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("tw_user_name", name);
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  const start = new Date(Math.max(aStart.getTime(), bStart.getTime()));
  const end = new Date(Math.min(aEnd.getTime(), bEnd.getTime()));
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? ms / 60000 : 0;
}

export default function RequestPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [req, setReq] = useState<HangRequest | null>(null);
  const [rows, setRows] = useState<WindowRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(getUserName());
  const userKey = useMemo(() => getUserKey(), []);

  // Local form state for adding windows
  const [startLocal, setStartLocal] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [endLocal, setEndLocal] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000))
  );
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    const { data: reqData, error: reqErr } = await supabase
      .from("hang_requests")
      .select("*")
      .eq("slug", slug)
      .single();

    if (reqErr) {
      setErr(reqErr.message);
      setLoading(false);
      return;
    }
    setReq(reqData as HangRequest);

    const { data: winData, error: winErr } = await supabase
      .from("availability_windows")
      .select("*")
      .eq("request_id", (reqData as any).id)
      .order("created_at", { ascending: false });

    if (winErr) setErr(winErr.message);
    setRows((winData as WindowRow[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function addWindow() {
    setErr(null);
    if (!req) return;
    if (!name.trim()) {
      setErr("Add your name first.");
      return;
    }
    setUserName(name.trim());

    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setErr("Invalid date/time.");
      return;
    }
    if (end <= start) {
      setErr("End must be after start.");
      return;
    }

    const { error } = await supabase.from("availability_windows").insert({
      request_id: req.id,
      user_key: userKey,
      user_name: name.trim(),
      start_ts: start.toISOString(),
      end_ts: end.toISOString(),
    });

    if (error) {
      setErr(error.message);
      return;
    }
    await load();
  }

  // Compute simple overlaps: pairwise overlaps across all windows, show 30+ min overlaps
  const overlaps = useMemo(() => {
    const out: { start: Date; end: Date; minutes: number }[] = [];
    const windows = rows.map((r) => ({
      start: new Date(r.start_ts),
      end: new Date(r.end_ts),
    }));

    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i];
        const b = windows[j];
        const mins = overlapMinutes(a.start, a.end, b.start, b.end);
        if (mins >= 30) {
          const start = new Date(Math.max(a.start.getTime(), b.start.getTime()));
          const end = new Date(Math.min(a.end.getTime(), b.end.getTime()));
          out.push({ start, end, minutes: Math.round(mins) });
        }
      }
    }

    // de-dupe roughly by start/end timestamps
    const seen = new Set<string>();
    const deduped = out.filter((o) => {
      const key = `${o.start.toISOString()}_${o.end.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by soonest
    deduped.sort((a, b) => a.start.getTime() - b.start.getTime());
    return deduped.slice(0, 8);
  }, [rows]);

  async function createPlanFromOverlap(start: Date, end: Date) {
    if (!req) return;
    const planSlug = nanoid(10);

    const { error } = await supabase.from("plans").insert({
      slug: planSlug,
      request_id: req.id,
      title: req.title,
      type: req.type,
      note: req.note,
      start_ts: start.toISOString(),
      end_ts: end.toISOString(),
    });

    if (error) {
      setErr(error.message);
      return;
    }
    router.push(`/p/${planSlug}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <div className="text-sm text-neutral-500">Loading…</div>
      </main>
    );
  }

  if (!req) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <div className="text-sm text-red-600">Request not found.</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{req.title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{req.type}</p>
          {req.note && <p className="text-sm mt-3">{req.note}</p>}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="border rounded-xl p-4">
          <h2 className="font-medium">Add your availability</h2>

          <div className="mt-3 space-y-2">
            <label className="text-sm font-medium">Your name</label>
            <input
              className="w-full border rounded-lg p-2 bg-transparent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kate"
            />

            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Start</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg p-2 bg-transparent"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">End</label>
                <input
                  type="datetime-local"
                  className="w-full border rounded-lg p-2 bg-transparent"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={addWindow}
              className="w-full mt-3 rounded-lg bg-black text-white py-2"
            >
              Add window
            </button>

            {err && (
              <div className="text-sm text-red-600 border border-red-200 rounded-lg p-3 mt-3">
                {err}
              </div>
            )}
          </div>
        </section>

        <section className="border rounded-xl p-4">
          <h2 className="font-medium">Windows so far</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Everyone’s submissions (refreshes when you add).
          </p>

          <div className="mt-3 space-y-2 max-h-72 overflow-auto">
            {rows.length === 0 && (
              <div className="text-sm text-neutral-500">No windows yet.</div>
            )}
            {rows.map((r) => (
              <div key={r.id} className="border rounded-lg p-3">
                <div className="text-sm font-medium">
                  {r.user_name || "Someone"}
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                  {new Date(r.start_ts).toLocaleString()} →{" "}
                  {new Date(r.end_ts).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-6 border rounded-xl p-4">
        <h2 className="font-medium">Suggested overlaps</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Tap one to lock it in and create the plan link.
        </p>

        <div className="mt-3 grid gap-2">
          {overlaps.length === 0 && (
            <div className="text-sm text-neutral-500">
              Add at least two windows (from two people) to see overlaps.
            </div>
          )}

          {overlaps.map((o) => (
            <button
              key={o.start.toISOString() + o.end.toISOString()}
              onClick={() => createPlanFromOverlap(o.start, o.end)}
              className="text-left border rounded-lg p-3 hover:bg-neutral-50"
            >
              <div className="text-sm font-medium">
                {o.start.toLocaleString()} → {o.end.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Overlap: {o.minutes} minutes
              </div>
            </button>
          ))}
        </div>
      </section>

      <p className="text-xs text-neutral-500 mt-6">
        Next: we’ll build <code>/p/[slug]</code> to show the “plan card” widget.
      </p>
    </main>
  );
}
