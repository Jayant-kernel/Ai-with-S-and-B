"use client";

import { ArrowLeft, Check, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

type VisibleItem = { id: string; kind: string; updatedAt: string; text: string };
type DiscardedItem = { id: string; kind: string; updatedAt: string; category: string };
type MemoryResponse = {
  configured: boolean;
  approved: VisibleItem[];
  pending: VisibleItem[];
  discarded: DiscardedItem[];
};

const DISCARD_COPY: Record<string, string> = {
  preference: "noticed something personal (a preference)",
  relationship: "noticed something personal (about a relationship)",
  future_event: "noticed something personal (an upcoming plan)",
  health: "noticed something personal (a health mention)",
  financial: "noticed something about money",
  secret: "noticed something you'd want kept private",
  unknown: "noticed something sensitive",
  user_declined: "you chose not to keep this",
};

function discardMessage(category: string) {
  return category === "user_declined"
    ? "You chose not to keep this."
    : `Saathi ${DISCARD_COPY[category] ?? "noticed something sensitive"} and chose not to remember it.`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

// The initial load happens server-side, in app/memory/page.tsx, so this
// component never needs a mount-time fetch effect -- it starts already
// showing real data (or the server's honest fallback if that load failed).
// Every reload after this is user-triggered (an Approve/Discard click),
// which is a plain async event handler, not an effect.
export function MemoryReview({
  initialData,
  initialLoadFailed = false,
}: {
  initialData: MemoryResponse;
  initialLoadFailed?: boolean;
}) {
  const [data, setData] = useState(initialData);
  const [loadError, setLoadError] = useState(
    initialLoadFailed ? "Saathi could not load what it remembers right now. Please try again." : "",
  );
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      if (!response.ok) throw new Error("request_failed");
      setData((await response.json()) as MemoryResponse);
      setLoadError("");
    } catch {
      setLoadError("Saathi could not load what it remembers right now. Please try again.");
    }
  }, []);

  const act = useCallback(async (id: string, action: "approve" | "discard") => {
    setPendingActionId(id);
    setActionError("");
    try {
      const response = await fetch(`/api/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("request_failed");
      await reload();
    } catch {
      setActionError("That did not go through. Please try again.");
    } finally {
      setPendingActionId(null);
    }
  }, [reload]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-7 sm:px-10 sm:py-10">
      <header className="flex min-h-16 items-center justify-between gap-4">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-teal-800">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Saathi
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            What Saathi remembers
          </h1>
        </div>
      </header>

      <p className="mt-3 max-w-xl text-lg leading-7 text-slate-600">
        Saathi only remembers a few durable facts you talk about, and never anything about money,
        passwords, or things you asked to keep private -- those are noticed and thrown away, never saved.
      </p>

      {loadError && (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-lg text-red-800" role="alert">
          {loadError}
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-3 rounded-lg border-2 border-red-300 bg-white px-3 py-1 text-base font-bold text-red-800"
          >
            Try again
          </button>
        </div>
      )}

      {!loadError && !data.configured && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-lg text-slate-700">
          Memory is not turned on for this Saathi yet. Once a family member sets it up, what Saathi
          remembers will show up here.
        </div>
      )}

      {!loadError && data.configured && (
        <div className="mt-8 flex flex-col gap-8">
          {actionError && (
            <p className="rounded-xl bg-red-50 p-3 text-base font-semibold text-red-800" role="alert">{actionError}</p>
          )}

          <Section title="Remembered" hint="Saathi will bring these up naturally in future conversations.">
            {data.approved.length === 0
              ? <Empty text="Nothing has been confirmed yet." />
              : data.approved.map((item) => (
                <li key={item.id} className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
                  <p className="text-lg leading-7 text-slate-900">{item.text}</p>
                  <p className="mt-1 text-sm text-slate-500">Since {formatDate(item.updatedAt)}</p>
                </li>
              ))}
          </Section>

          <Section title="Waiting for your OK" hint="Saathi noticed these but will not use them until you confirm.">
            {data.pending.length === 0
              ? <Empty text="Nothing is waiting for review." />
              : data.pending.map((item) => (
                <li key={item.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-lg leading-7 text-slate-900">{item.text}</p>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      disabled={pendingActionId === item.id}
                      onClick={() => void act(item.id, "approve")}
                      className="flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 text-base font-bold text-white disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" /> Remember this
                    </button>
                    <button
                      type="button"
                      disabled={pendingActionId === item.id}
                      onClick={() => void act(item.id, "discard")}
                      className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-red-300 bg-white px-4 text-base font-bold text-red-800 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" aria-hidden="true" /> Don&apos;t keep it
                    </button>
                  </div>
                </li>
              ))}
          </Section>

          <Section title="Not saved" hint="Saathi never stored what was actually said here -- only that it noticed something.">
            {data.discarded.length === 0
              ? <Empty text="Nothing has been set aside." />
              : data.discarded.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-lg leading-7 text-slate-700">{discardMessage(item.category)}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatDate(item.updatedAt)}</p>
                </li>
              ))}
          </Section>
        </div>
      )}
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
      <p className="mt-1 text-base text-slate-600">{hint}</p>
      <ul className="mt-4 flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <li className="rounded-2xl border border-dashed border-slate-300 p-4 text-base text-slate-500">{text}</li>;
}
