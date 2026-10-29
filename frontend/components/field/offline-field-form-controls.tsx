"use client";

import type { FieldSyncState } from "@/lib/offline-field-forms";

export function OfflineFieldFormControls({
  state,
  pendingCount,
  message,
  syncing,
  syncNow,
}: {
  state: FieldSyncState;
  pendingCount: number;
  message: string | null;
  syncing: boolean;
  syncNow: (manual?: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <span className="font-medium">{state}</span>
      <span className="text-muted-foreground">
        {pendingCount} pending operation{pendingCount === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={() => syncNow(true)}
        disabled={syncing || pendingCount === 0}
        className="rounded-md border border-border px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {syncing ? "Syncing..." : "Sync Now"}
      </button>
      {message && (
        <span role="status" className="basis-full text-amber-700">
          {message}
        </span>
      )}
    </div>
  );
}
