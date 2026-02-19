"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { supabase } from "@/lib/supabase";

const EVENT_TYPES = [
  "Potluck",
  "Cabin creative coworking",
  "Dance class",
  "Playdate",
] as const;

type EventType = (typeof EVENT_TYPES)[number];

export default function NewRequestPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("Playdate");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRequest() {
    setError(null);
    setLoading(true);

    try {
      const slug = nanoid(10);

      // Minimal “request” row. We’ll add availability windows on the next page.
      const { error: insertErr } = await supabase.from("hang_requests").insert({
        slug,
        title: title.trim() || `${type}`,
        type,
        note: note.trim() || null,
      });

      if (insertErr) throw insertErr;

      router.push(`/r/${slug}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold">Create a hang link</h1>
      <p className="text-sm text-neutral-500 mt-1">
        Make a link you can drop into iMessage/WhatsApp to collect availability.
      </p>

      <div className="mt-6 space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Type</label>
          <select
            className="w-full border rounded-lg p-2 bg-transparent"
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Title (optional)</label>
          <input
            className="w-full border rounded-lg p-2 bg-transparent"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Tuesday playdate at the park"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Note (optional)</label>
          <textarea
            className="w-full border rounded-lg p-2 bg-transparent"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything people should know (location ideas, vibe, etc.)"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        <button
          onClick={createRequest}
          disabled={loading}
          className="w-full rounded-lg bg-black text-white py-2 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create link"}
        </button>
      </div>

      <p className="text-xs text-neutral-500 mt-6">
        Next: you’ll land on the availability page (we’ll build it next).
      </p>
    </main>
  );
}
