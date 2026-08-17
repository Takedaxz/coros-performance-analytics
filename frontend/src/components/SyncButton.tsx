"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createSSEConnection } from "@/lib/api";

interface SyncState {
  isSyncing: boolean;
  message: string;
  error: string | null;
}

interface SyncButtonProps {
  onSyncComplete?: () => void;
}

export default function SyncButton({ onSyncComplete }: SyncButtonProps) {
  const streamRef = useRef<EventSource | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    message: "",
    error: null,
  });

  const connectToJob = useCallback((jobId: string) => {
    streamRef.current?.close();

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    streamRef.current = createSSEConnection(
      `/api/sync/stream?job_id=${jobId}`,
      (event, data) => {
        if (event === "ping") return;
        try {
          const parsed = JSON.parse(data);
          if (event === "progress") {
            setSyncState((prev) => ({
              ...prev,
              message: parsed.message || prev.message,
            }));
          } else if (event === "complete") {
            streamRef.current = null;
            setSyncState({ isSyncing: false, message: "", error: null });
            onSyncComplete?.();
          } else if (event === "error") {
            streamRef.current = null;
            setSyncState((prev) => ({
              ...prev,
              isSyncing: false,
              error: parsed.message || "Sync error",
            }));
          }
        } catch {
          // Non-JSON event data, ignore
        }
      },
      async () => {
        try {
          const res = await fetch(`${apiBase}/api/sync/status`);
          if (res.ok) {
            const status: { is_syncing: boolean; active_job_id: string | null; last_sync_status: string } =
              await res.json();
            if (status.is_syncing && status.active_job_id) {
              connectToJob(status.active_job_id);
              return;
            }
            if (status.last_sync_status === "completed") {
              streamRef.current = null;
              setSyncState({ isSyncing: false, message: "", error: null });
              onSyncComplete?.();
              return;
            }
          }
        } catch {}

        streamRef.current = null;
        setSyncState((prev) => ({
          ...prev,
          isSyncing: false,
          message: "",
          error: prev.error ?? "Sync connection lost",
        }));
      }
    );
  }, [onSyncComplete]);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    void fetch(`${apiBase}/api/sync/status`)
      .then(async (response) => {
        if (!response.ok) return;
        const status: { is_syncing: boolean; active_job_id: string | null } = await response.json();
        if (status.is_syncing && status.active_job_id) {
          setSyncState({ isSyncing: true, message: "Syncing COROS data...", error: null });
          connectToJob(status.active_job_id);
        }
      })
      .catch(() => {});

    return () => streamRef.current?.close();
  }, [connectToJob]);

  const triggerSync = useCallback(async () => {
    if (syncState.isSyncing) return;

    setSyncState({ isSyncing: true, message: "Connecting to COROS...", error: null });

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiBase}/api/sync/now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const { job_id } = await response.json();
      connectToJob(job_id);
    } catch (err) {
      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        message: "",
        error: err instanceof Error ? err.message : "Sync failed",
      }));
    }
  }, [connectToJob, syncState.isSyncing]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <button
        className={`btn btn-secondary sync-btn ${syncState.isSyncing ? "syncing" : ""}`}
        onClick={triggerSync}
        disabled={syncState.isSyncing}
        id="sync-now-button"
        aria-busy={syncState.isSyncing}
        aria-label={syncState.isSyncing ? "Syncing COROS data" : "Sync COROS data"}
        title={syncState.isSyncing ? "Syncing COROS data" : "Sync COROS data"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>

      {syncState.isSyncing && (
        <div className="sync-toast" role="status" aria-live="polite">
          {syncState.message}
        </div>
      )}

      {syncState.error && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
          {syncState.error}
        </span>
      )}

    </div>
  );
}
