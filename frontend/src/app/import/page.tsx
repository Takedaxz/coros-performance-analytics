"use client";

import { useState, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";

interface ImportJob {
  id: string;
  filename: string;
  status: string;
  activities_created: number;
  activities_duplicate: number;
  errors_count: number;
}

export default function ImportPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ status: string; message?: string; job_id?: string } | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/import/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setResult(data);

      // Refresh job list
      const jobsRes = await fetch(`${apiBase}/api/import/jobs`);
      if (jobsRes.ok) {
        setJobs(await jobsRes.json());
      }
    } catch (err) {
      setResult({
        status: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }

    setUploading(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Import Data</h2>
        </header>
        <div className="page-body">
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            {/* Upload Zone */}
            <div
              className={`drop-zone ${isDragging ? "dragover" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              id="import-drop-zone"
            >
              <div className="drop-zone-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="drop-zone-text">
                <strong>Drop FIT, TCX, or ZIP files here</strong>
                <br />
                or click to browse. Supports COROS Training Hub bulk exports.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".fit,.tcx,.zip"
                onChange={handleFileSelect}
                style={{ display: "none" }}
                id="import-file-input"
              />
            </div>

            {/* Upload Progress */}
            {uploading && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <div className="progress-bar progress-bar-indeterminate">
                  <div className="progress-bar-fill" />
                </div>
                <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)", textAlign: "center" }}>
                  Uploading and processing...
                </p>
              </div>
            )}

            {/* Result */}
            {result && (
              <div
                className="card"
                style={{
                  marginTop: "var(--space-4)",
                  borderColor: result.status === "accepted" ? "var(--color-success)" : result.status === "duplicate" ? "var(--color-warning)" : "var(--color-error)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  {result.status === "accepted" && <span className="badge badge-success">Accepted</span>}
                  {result.status === "duplicate" && <span className="badge" style={{ background: "rgba(245,158,11,0.1)", color: "var(--color-warning)", border: "1px solid rgba(245,158,11,0.2)" }}>Duplicate</span>}
                  {result.status === "error" && <span className="badge badge-anomaly">Error</span>}
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                    {result.message || (result.status === "accepted" ? "File queued for processing." : "")}
                  </span>
                </div>
              </div>
            )}

            {/* Import History */}
            {jobs.length > 0 && (
              <div className="card" style={{ marginTop: "var(--space-6)" }}>
                <div className="card-header">
                  <div className="card-title">Import History</div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Duplicates</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>{job.filename}</td>
                        <td><span className={`badge ${job.status === "completed" ? "badge-success" : "badge-source"}`}>{job.status}</span></td>
                        <td className="mono">{job.activities_created}</td>
                        <td className="mono">{job.activities_duplicate}</td>
                        <td className="mono">{job.errors_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Format Info */}
            <div className="card" style={{ marginTop: "var(--space-6)", borderColor: "transparent" }}>
              <div className="card-title" style={{ marginBottom: "var(--space-3)" }}>Supported Formats</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
                <div style={{ padding: "var(--space-3)", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: "var(--space-1)" }}>.FIT</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Full sensor data, GPS, HR, power</div>
                </div>
                <div style={{ padding: "var(--space-3)", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: "var(--space-1)" }}>.TCX</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>XML format with extensions</div>
                </div>
                <div style={{ padding: "var(--space-3)", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
                  <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, marginBottom: "var(--space-1)" }}>.ZIP</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Bulk Training Hub export</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
