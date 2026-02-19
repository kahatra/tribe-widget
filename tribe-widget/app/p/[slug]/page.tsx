"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Plan = {
  id: string;
  slug: string;
  title: string;
  type: string;
  note: string | null;
  start_ts: string;
  end_ts: string;
  location: string | null;
  created_at: string;
};

type ResponseRow = {
  id: string;
  plan_id: string;
  user_key: string;
  user_name: string | null;
  status: "in" | "maybe" | "out";
  arrival: string | null;
  created_at: string;
};

type ClaimRow = {
  id: string;
  plan_id: string;
  item: string;
  claimed_by: string | null;
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

const ARRIVAL_OPTIONS = ["On time", "5–10 late", "10–20 late", "Not sure"] as const;

const DEFAULT_POTLUCK_ITEMS = [
  "Main dish",
  "Salad / Veg",
  "Snack / App",
  "Dessert",
  "Drinks",
] as const;

export default function PlanPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState(getUserName());
  const userKey = useMemo(() => getUserKey(), []);

  async function load(showSpinner: boolean = true) {
    if (showSpinner) setLoading(true);
    setErr(null);

    const { data: planData, error: planErr } = await supabase
      .from("plans")
      .select("*")
      .eq("slug", slug)
      .single();

    if (planErr) {
      setErr(planErr.message);
      if (showSpinner) setLoading(false);
      return;
    }
    setPlan(planData as Plan);

    const planId = (planData as any).id;

    const { data: respData, error: respErr } = await supabase
      .from("responses")
      .select("*")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false });

    if (respErr) setErr(respErr.message);
    setResponses((respData as ResponseRow[]) || []);

    const { data: claimData, error: claimErr } = await supabase
      .from("claims")
      .select("*")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false });

    if (claimErr) setErr(claimErr.message);
    setClaims((claimData as ClaimRow[]) || []);

    if (showSpinner) setLoading(false);
  }

  // Initial load on slug
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Poll for updates (simple MVP realtime)
  useEffect(() => {
    const id = setInterval(() => {
      load(false);
    }, 2000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const myResponse = useMemo(() => {
    if (!plan) return null;
    return responses.find((r) => r.user_key === userKey) || null;
  }, [responses, userKey, plan]);

  async function setRSVP(status: "in" | "maybe" | "out") {
    if (!plan) return;
    setErr(null);

    if (!name.trim()) {
      setErr("Add your name first.");
      return;
    }
    setUserName(name.trim());

    const payload = {
      plan_id: plan.id,
      user_key: userKey,
      user_name: name.trim(),
      status,
      arrival: myResponse?.arrival ?? null,
    };

    const { error } = await supabase.from("responses").upsert(payload, {
      onConflict: "plan_id,user_key",
    });

    if (error) {
      setErr(error.message);
      return;
    }
    await load(false);
  }

  async function setArrival(arrival: string) {
    if (!plan) return;
    setErr(null);

    if (!name.trim()) {
      setErr("Add your name first.");
      return;
    }
    setUserName(name.trim());

    const payload = {
      plan_id: plan.id,
      user_key: userKey,
      user_name: name.trim(),
      status: myResponse?.status ?? "maybe",
      arrival,
    };

    const { error } = await supabase.from("responses").upsert(payload, {
      onConflict: "plan_id,user_key",
    });

    if (error) {
      setErr(error.message);
      return;
    }
    await load(false);
  }

  const counts = useMemo(() => {
    const c = { in: 0, maybe: 0, out: 0 };
    for (const r of responses) c[r.status]++;
    return c;
  }, [responses]);

  async function ensurePotluckDefaults() {
    if (!plan) return;
    const existing = new Set(claims.map((c) => c.item));
    const missing = DEFAULT_POTLUCK_ITEMS.filter((i) => !existing.has(i));
    if (missing.length === 0) return;

    const { error } = await supabase.from("claims").insert(
      missing.map((item) => ({
        plan_id: plan.id,
        item,
        claimed_by: null,
      }))
    );
    if (error) setErr(error.message);
    await load(false);
  }

  async function claimItem(item: string) {
    if (!plan) return;
    setErr(null);

    if (!name.trim()) {
      setErr("Add your name first.");
      return;
    }
    setUserName(name.trim());

    const existing = claims.find((c) => c.item === item);
    if (!existing) return;

    const { error } = await supabase
      .from("claims")
      .update({ claimed_by: name.trim() })
      .eq("id", existing.id);

    if (error) {
      setErr(error.message);
      return;
    }
    await load(false);
  }

  async function unclaimItem(item: string) {
    if (!plan) return;
    setErr(null);

    const existing = claims.find((c) => c.item === item);
    if (!existing) return;

    if ((existing.claimed_by || "") !== (name.trim() || "")) {
      setErr("Only the person who claimed it can unclaim.");
      return;
    }

    const { error } = await supabase
      .from("claims")
      .update({ claimed_by: null })
      .eq("id", existing.id);

    if (error) {
      setErr(error.message);
      return;
    }
    await load(false);
  }

  useEffect(() => {
    if (plan?.type?.toLowerCase().includes("potluck")) {
      ensurePotluckDefaults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  if (loading) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <div className="text-sm text-neutral-500">Loading…</div>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-screen p-6 max-w-2xl mx-auto">
        <div className="text-sm text-red-600">Plan not found.</div>
      </main>
    );
  }

  const isPotluck = plan.type.toLowerCase().includes("potluck");
  const isPlaydate = plan.type.toLowerCase().includes("playdate");

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <header className="border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{plan.title}</h1>
            <p className="text-sm text-neutral-500 mt-1">{plan.type}</p>
          </div>
          <div className="text-right text-xs text-neutral-500">
            <div>
              {new Date(plan.start_ts).toLocaleString()} →{" "}
              {new Date(plan.end_ts).toLocaleString()}
            </div>
            {plan.location && <div className="mt-1">📍 {plan.location}</div>}
          </div>
        </div>

        {plan.note && <p className="text-sm mt-3">{plan.note}</p>}

        <div className="mt-4 flex gap-2 text-sm">
          <span className="px-2 py-1 rounded-full border">
            In: <b>{counts.in}</b>
          </span>
          <span className="px-2 py-1 rounded-full border">
            Maybe: <b>{counts.maybe}</b>
          </span>
          <span className="px-2 py-1 rounded-full border">
            Out: <b>{counts.out}</b>
          </span>
        </div>
      </header>

      <section className="mt-5 border rounded-2xl p-5">
        <h2 className="font-medium">Your RSVP</h2>

        <div className="mt-3 space-y-2">
          <label className="text-sm font-medium">Your name</label>
          <input
            className="w-full border rounded-lg p-2 bg-transparent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kate"
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => setRSVP("in")}
            className={`rounded-lg border p-3 ${
              myResponse?.status === "in" ? "bg-black text-white" : ""
            }`}
          >
            In
          </button>
          <button
            onClick={() => setRSVP("maybe")}
            className={`rounded-lg border p-3 ${
              myResponse?.status === "maybe" ? "bg-black text-white" : ""
            }`}
          >
            Maybe
          </button>
          <button
            onClick={() => setRSVP("out")}
            className={`rounded-lg border p-3 ${
              myResponse?.status === "out" ? "bg-black text-white" : ""
            }`}
          >
            Out
          </button>
        </div>

        {isPlaydate && (
          <div className="mt-4">
            <label className="text-sm font-medium">Arrival</label>
            <select
              className="w-full border rounded-lg p-2 bg-transparent mt-1"
              value={myResponse?.arrival || ""}
              onChange={(e) => setArrival(e.target.value)}
            >
              <option value="">Select…</option>
              {ARRIVAL_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-500 mt-2">
              Useful for playdates (kids + naps + chaos).
            </p>
          </div>
        )}

        {err && (
          <div className="text-sm text-red-600 border border-red-200 rounded-lg p-3 mt-4">
            {err}
          </div>
        )}
      </section>

      {isPotluck && (
        <section className="mt-5 border rounded-2xl p-5">
          <h2 className="font-medium">Potluck claims</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Tap to claim an item so fewer texts happen.
          </p>

          <div className="mt-3 space-y-2">
            {claims.length === 0 && (
              <div className="text-sm text-neutral-500">Loading items…</div>
            )}

            {claims.map((c) => {
              const mine = (c.claimed_by || "") === (name.trim() || "");
              return (
                <div
                  key={c.id}
                  className="border rounded-lg p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-medium">{c.item}</div>
                    <div className="text-xs text-neutral-500 mt-1">
                      {c.claimed_by ? `Claimed by ${c.claimed_by}` : "Unclaimed"}
                    </div>
                  </div>

                  {!c.claimed_by && (
                    <button
                      onClick={() => claimItem(c.item)}
                      className="rounded-lg bg-black text-white px-3 py-2 text-sm"
                    >
                      Claim
                    </button>
                  )}

                  {c.claimed_by && mine && (
                    <button
                      onClick={() => unclaimItem(c.item)}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >
                      Unclaim
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-5 border rounded-2xl p-5">
        <h2 className="font-medium">Who’s coming</h2>
        <div className="mt-3 space-y-2">
          {responses.length === 0 && (
            <div className="text-sm text-neutral-500">No RSVPs yet.</div>
          )}

          {responses.map((r) => (
            <div key={r.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{r.user_name || "Someone"}</div>
                <span className="text-xs px-2 py-1 rounded-full border">
                  {r.status.toUpperCase()}
                </span>
              </div>
              {r.arrival && (
                <div className="text-xs text-neutral-500 mt-1">
                  Arrival: {r.arrival}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 text-xs text-neutral-500">
          It refreshes automatically every ~2 seconds.
        </div>
      </section>
    </main>
  );
}
