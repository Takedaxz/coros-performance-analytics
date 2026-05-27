"use client";

import { useState, useCallback } from "react";
import { createSSEConnection } from "@/lib/api";

interface SyncState {
  isSyncing: boolean;
  stage: string;
  message: string;
  error: string | null;
  lastSyncAt: string | null;
}

interface SyncButtonProps {
  onSyncComplete?: () => void;
}

export default function SyncButton({ onSyncComplete }: SyncButtonProps) {
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    stage: "",
    message: "",
    error: null,
    lastSyncAt: null,
  });

  const triggerSync = useCallback(async () => {
    if (syncState.isSyncing) return;

    setSyncState((prev) => ({
      ...prev,
      isSyncing: true,
      stage: "starting",
      message: "Connecting to COROS...",
      error: null,
    }));

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

      createSSEConnection(
        `/api/sync/stream?job_id=${job_id}`,
        (event, data) => {
          try {
            const parsed = JSON.parse(data);
            if (event === "progress") {
              setSyncState((prev) => ({
                ...prev,
                stage: parsed.stage || "",
                message: parsed.message || `Synced ${parsed.count || 0} records`,
              }));
            } else if (event === "complete") {
              setSyncState({
                isSyncing: false,
                stage: "complete",
                message: parsed.message || "Sync complete",
                error: null,
                lastSyncAt: new Date().toISOString(),
              });
              if (onSyncComplete) onSyncComplete();
            } else if (event === "error") {
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
        () => {
          setSyncState((prev) => ({
            ...prev,
            isSyncing: false,
            error: "Connection lost",
          }));
        }
      );
    } catch (err) {
      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        error: err instanceof Error ? err.message : "Sync failed",
      }));
    }
  }, [syncState.isSyncing, onSyncComplete]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <button
        className={`btn btn-secondary sync-btn ${syncState.isSyncing ? "syncing" : ""}`}
        onClick={triggerSync}
        disabled={syncState.isSyncing}
        id="sync-now-button"
        style={{ padding: "6px 12px", fontSize: "var(--text-sm)" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            width: 14,
            height: 14,
            animation: syncState.isSyncing ? "spin 1s linear infinite" : "none",
          }}
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        {syncState.isSyncing ? "Syncing..." : "Sync"}
      </button>

      {syncState.isSyncing && (
        <span className="sync-status">
          <span className="sync-dot" />
          {syncState.message}
        </span>
      )}

      {syncState.error && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
          {syncState.error}
        </span>
      )}

      {!syncState.isSyncing && syncState.lastSyncAt && (
        <span className="sync-status">
          <span className="sync-dot" />
          Last sync: {new Date(syncState.lastSyncAt).toLocaleTimeString()}
        </span>
      )}

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
