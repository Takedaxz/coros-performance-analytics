"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import type { SyncStatus } from "@/lib/types";

interface AppStatus {
  app_env: string;
  gemini_enabled: boolean;
  api_enabled: boolean;
}

interface UserGoal {
  goal_description: string;
  goal_race_name: string;
  goal_race_date: string;
  goal_target_time: string;
  weekly_training_hours: string;
}

interface UserProfile {
  first_name: string;
  last_name: string;
  nickname: string;
  birthdate: string;
  height_cm: string;
  weight_kg: string;
  body_fat_pct: string;
}

const EMPTY_GOAL: UserGoal = {
  goal_description: "",
  goal_race_name: "",
  goal_race_date: "",
  goal_target_time: "",
  weekly_training_hours: "",
};

const EMPTY_PROFILE: UserProfile = {
  first_name: "",
  last_name: "",
  nickname: "",
  birthdate: "",
  height_cm: "",
  weight_kg: "",
  body_fat_pct: "",
};

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function SettingsPage() {
  const [syncConfig, setSyncConfig] = useState<SyncStatus | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [goal, setGoal] = useState<UserGoal>(EMPTY_GOAL);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalError, setGoalError] = useState("");

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch(`${apiBase}/api/sync/status`);
        if (res.ok) setSyncConfig(await res.json());
      } catch {
        // Backend not available
      }
      try {
        const res2 = await fetch(`${apiBase}/api/settings/status`);
        if (res2.ok) setAppStatus(await res2.json());
      } catch {
        // Backend not available
      }
    }

    async function fetchGoal() {
      try {
        const res = await fetch(`${apiBase}/api/settings/goal`);
        if (res.ok) {
          const data = await res.json();
          setGoal({
            goal_description: data.goal_description ?? "",
            goal_race_name: data.goal_race_name ?? "",
            goal_race_date: data.goal_race_date ?? "",
            goal_target_time: data.goal_target_time ?? "",
            weekly_training_hours: data.weekly_training_hours?.toString() ?? "",
          });
        }
      } catch {
        // Backend not available
      }
    }

    async function fetchProfile() {
      try {
        const res = await fetch(`${apiBase}/api/settings/profile`);
        if (res.ok) {
          const data = await res.json();
          setProfile({
            first_name: data.first_name ?? "",
            last_name: data.last_name ?? "",
            nickname: data.nickname ?? "",
            birthdate: data.birthdate ?? "",
            height_cm: data.height_cm?.toString() ?? "",
            weight_kg: data.weight_kg?.toString() ?? "",
            body_fat_pct: data.body_fat_pct?.toString() ?? "",
          });
        }
      } catch {}
    }

    fetchConfig();
    fetchGoal();
    fetchProfile();
  }, [apiBase]);

  async function saveGoal() {
    setGoalSaving(true);
    setGoalError("");
    setGoalSaved(false);
    try {
      const res = await fetch(`${apiBase}/api/settings/goal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal_description: goal.goal_description || null,
          goal_race_name: goal.goal_race_name || null,
          goal_race_date: goal.goal_race_date || null,
          goal_target_time: goal.goal_target_time || null,
          weekly_training_hours: goal.weekly_training_hours
            ? parseFloat(goal.weekly_training_hours)
            : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGoalSaved(true);
      setTimeout(() => setGoalSaved(false), 3000);
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setGoalSaving(false);
    }
  }

  async function saveProfile() {
    setProfileSaving(true);
    setProfileError("");
    setProfileSaved(false);
    try {
      const res = await fetch(`${apiBase}/api/settings/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: profile.first_name || null,
          last_name: profile.last_name || null,
          nickname: profile.nickname || null,
          birthdate: profile.birthdate || null,
          height_cm: profile.height_cm ? parseFloat(profile.height_cm) : null,
          weight_kg: profile.weight_kg ? parseFloat(profile.weight_kg) : null,
          body_fat_pct: profile.body_fat_pct ? parseFloat(profile.body_fat_pct) : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setProfileSaving(false);
    }
  }

  const daysLeft = daysUntil(goal.goal_race_date);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Settings</h2>
        </header>
        <div className="page-body">

          {/* User Profile & Biometrics */}
          <div className="card animate-fade-in" style={{ marginBottom: "var(--space-4)" }} id="settings-profile">
            <div className="card-header">
              <div className="card-title">User Profile & Biometrics</div>
            </div>

            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              Keep your profile up to date so the AI coach can better estimate training zones, calories, and biological age insights.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    First Name
                  </label>
                  <input
                    type="text"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. John"
                    value={profile.first_name}
                    onChange={(e) => setProfile((p) => ({ ...p, first_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. Doe"
                    value={profile.last_name}
                    onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Nickname
                  </label>
                  <input
                    type="text"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. Johnny"
                    value={profile.nickname}
                    onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Birthdate
                  </label>
                  <input
                    type="date"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    value={profile.birthdate}
                    onChange={(e) => setProfile((p) => ({ ...p, birthdate: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="300"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. 180"
                    value={profile.height_cm}
                    onChange={(e) => setProfile((p) => ({ ...p, height_cm: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    min="20"
                    max="300"
                    step="0.1"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. 75.5"
                    value={profile.weight_kg}
                    onChange={(e) => setProfile((p) => ({ ...p, weight_kg: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Body Fat (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="80"
                    step="0.1"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. 15.0"
                    value={profile.body_fat_pct}
                    onChange={(e) => setProfile((p) => ({ ...p, body_fat_pct: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                <button
                  className="btn btn-primary"
                  onClick={saveProfile}
                  disabled={profileSaving}
                >
                  {profileSaving ? "Saving…" : "Save Profile"}
                </button>
                {profileSaved && (
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-accent-emerald)" }}>
                    Saved successfully.
                  </span>
                )}
                {profileError && (
                  <span style={{ fontSize: "var(--text-sm)", color: "#ef4444" }}>
                    {profileError}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Training Goal */}
          <div className="card animate-fade-in" style={{ marginBottom: "var(--space-4)" }} id="settings-goal">
            <div className="card-header">
              <div className="card-title">Training Goal</div>
              {goal.goal_race_date && daysLeft !== null && (
                <span
                  className="badge"
                  style={{
                    background: daysLeft <= 30 ? "rgba(245,158,11,0.15)" : "rgba(52,211,153,0.12)",
                    color: daysLeft <= 30 ? "#f59e0b" : "var(--color-accent-emerald)",
                    border: `1px solid ${daysLeft <= 30 ? "#f59e0b44" : "rgba(52,211,153,0.3)"}`,
                  }}
                >
                  {daysLeft}d to race
                </span>
              )}
            </div>

            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              Set your goal here — the AI coach will use it when giving training advice, load recommendations, and briefings.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {/* Race name */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Target Race / Event
                  </label>
                  <input
                    id="goal-race-name"
                    type="text"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. ICMM 2026 Full Marathon"
                    value={goal.goal_race_name}
                    onChange={(e) => setGoal((g) => ({ ...g, goal_race_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Race Date
                  </label>
                  <input
                    id="goal-race-date"
                    type="date"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    value={goal.goal_race_date}
                    onChange={(e) => setGoal((g) => ({ ...g, goal_race_date: e.target.value }))}
                  />
                </div>
              </div>

              {/* Target time + weekly hours */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Goal Finish Time
                  </label>
                  <input
                    id="goal-target-time"
                    type="text"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. 3:59:00"
                    value={goal.goal_target_time}
                    onChange={(e) => setGoal((g) => ({ ...g, goal_target_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Weekly Training Hours Target
                  </label>
                  <input
                    id="goal-weekly-hours"
                    type="number"
                    min="0"
                    max="40"
                    step="0.5"
                    className="chat-input"
                    style={{ fontSize: "var(--text-sm)", width: "100%" }}
                    placeholder="e.g. 10"
                    value={goal.weekly_training_hours}
                    onChange={(e) => setGoal((g) => ({ ...g, weekly_training_hours: e.target.value }))}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                  Additional Notes for AI Coach
                </label>
                <textarea
                  id="goal-description"
                  className="chat-input"
                  rows={3}
                  style={{ fontSize: "var(--text-sm)", resize: "vertical", fontFamily: "inherit", width: "100%" }}
                  placeholder="e.g. First marathon, want to run negative splits. Prone to left knee issues on long runs."
                  value={goal.goal_description}
                  onChange={(e) => setGoal((g) => ({ ...g, goal_description: e.target.value }))}
                />
              </div>

              {/* Save button + feedback */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                <button
                  id="save-goal-btn"
                  className="btn btn-primary"
                  onClick={saveGoal}
                  disabled={goalSaving}
                >
                  {goalSaving ? "Saving…" : "Save Goal"}
                </button>
                {goalSaved && (
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-accent-emerald)" }}>
                    Saved — AI coach updated.
                  </span>
                )}
                {goalError && (
                  <span style={{ fontSize: "var(--text-sm)", color: "#ef4444" }}>
                    {goalError}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* API Sync Configuration */}
          <div className="card" style={{ marginBottom: "var(--space-4)" }} id="settings-sync">
            <div className="card-header">
              <div className="card-title">COROS API Sync</div>
              {syncConfig?.api_enabled ? (
                <span className="badge badge-success">Connected</span>
              ) : (
                <span className="badge" style={{ background: "rgba(139,149,168,0.1)", color: "var(--color-text-muted)", border: "1px solid var(--border-color)" }}>
                  Disabled
                </span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              <div>
                <div className="metric-label">API Status</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", marginTop: "var(--space-1)" }}>
                  {syncConfig?.api_enabled ? "Configured" : "Missing Credentials"}
                </div>
              </div>
              <div>
                <div className="metric-label">Sync Interval</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", marginTop: "var(--space-1)" }}>
                  Every {syncConfig?.sync_interval_minutes || "15"} minutes
                </div>
              </div>
              <div>
                <div className="metric-label">Last Sync</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", marginTop: "var(--space-1)" }}>
                  {syncConfig?.last_sync_at || "Never"}
                </div>
              </div>
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-4)" }}>
              Configure your COROS email and password in the backend .env file.
            </p>
          </div>

          {/* AI Configuration */}
          <div className="card" style={{ marginBottom: "var(--space-4)" }} id="settings-ai">
            <div className="card-header">
              <div className="card-title">AI Analysis (Gemini)</div>
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <span className="badge badge-source">gemini-3.0-flash-preview</span>
                {appStatus?.gemini_enabled ? (
                  <span className="badge badge-success">Connected</span>
                ) : (
                  <span className="badge" style={{ background: "rgba(139,149,168,0.1)", color: "var(--color-text-muted)", border: "1px solid var(--border-color)" }}>
                    Disabled
                  </span>
                )}
              </div>
            </div>
            
            {appStatus?.gemini_enabled ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
                API key configured successfully. AI-powered weekly briefings, activity postmortems, and natural-language Q&A are active.
              </p>
            ) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                Set GEMINI_API_KEY and GEMINI_ENABLED=true in the backend .env file to enable AI-powered
                weekly briefings, activity postmortems, and natural-language Q&A.
              </p>
            )}
            
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-2)" }}>
              Only derived aggregates are sent to Gemini, never raw health data.
            </p>
          </div>

          {/* Data Management */}
          <div className="card" id="settings-data">
            <div className="card-header">
              <div className="card-title">Data Management</div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
              <button className="btn btn-secondary" id="export-data-btn">Export All Data</button>
              <button className="btn btn-danger" id="delete-data-btn">Delete All Data</button>
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-3)" }}>
              Your data is stored locally in PostgreSQL. Raw FIT/TCX files are preserved in the file store.
              Export downloads a complete backup. Delete is irreversible.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}
