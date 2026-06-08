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
  id?: string;
  goal_description: string;
  goal_race_name: string;
  goal_race_date: string;
  goal_target_time: string;
  weekly_training_hours: string;
  is_active?: boolean;
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
  is_active: true,
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

/** Returns the goal's lifecycle state based on race date vs. today */
function goalRaceState(dateStr: string): "upcoming" | "recovery" | "expired" | "no-date" {
  if (!dateStr) return "no-date";
  const days = daysUntil(dateStr);
  if (days === null) return "no-date";
  if (days >= 0) return "upcoming";
  if (days >= -30) return "recovery";  // 0–30 days after race
  return "expired";                    // 30+ days after race
}

export default function SettingsPage() {
  const [syncConfig, setSyncConfig] = useState<SyncStatus | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  
  // Multi-goal state
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalError, setGoalError] = useState("");

  // Edit/Add forms state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [isAddingGoal, setIsAddingGoal] = useState(false);
  const [goalForm, setGoalForm] = useState<UserGoal>(EMPTY_GOAL);

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  async function fetchGoals() {
    setGoalsLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/settings/goals`);
      if (res.ok) {
        const data = await res.json();
        setGoals(data.map((item: any) => ({
          id: item.id,
          goal_description: item.goal_description ?? "",
          goal_race_name: item.goal_race_name ?? "",
          goal_race_date: item.goal_race_date ?? "",
          goal_target_time: item.goal_target_time ?? "",
          weekly_training_hours: item.weekly_training_hours?.toString() ?? "",
          is_active: item.is_active,
        })));
      }
    } catch {
      // Backend not available
    } finally {
      setGoalsLoading(false);
    }
  }

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
    fetchGoals();
    fetchProfile();
  }, [apiBase]);

  async function saveGoal() {
    setGoalSaving(true);
    setGoalError("");
    setGoalSaved(false);

    const payload = {
      goal_description: goalForm.goal_description || null,
      goal_race_name: goalForm.goal_race_name || null,
      goal_race_date: goalForm.goal_race_date || null,
      goal_target_time: goalForm.goal_target_time || null,
      weekly_training_hours: goalForm.weekly_training_hours
        ? parseFloat(goalForm.weekly_training_hours)
        : null,
      is_active: goalForm.is_active ?? true,
    };

    try {
      let res;
      if (editingGoalId) {
        res = await fetch(`${apiBase}/api/settings/goals/${editingGoalId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${apiBase}/api/settings/goals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGoalSaved(true);
      setTimeout(() => setGoalSaved(false), 3000);

      // Reset states
      setEditingGoalId(null);
      setIsAddingGoal(false);
      setGoalForm(EMPTY_GOAL);
      
      await fetchGoals();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setGoalSaving(false);
    }
  }

  async function deleteGoal(id: string) {
    if (!confirm("Are you sure you want to delete this training goal?")) return;
    setGoalError("");
    try {
      const res = await fetch(`${apiBase}/api/settings/goals/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchGoals();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function toggleActive(id: string) {
    setGoalError("");
    try {
      const res = await fetch(`${apiBase}/api/settings/goals/${id}/toggle-active`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchGoals();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Failed to toggle status");
    }
  }

  function startEditGoal(g: UserGoal) {
    setEditingGoalId(g.id || null);
    setIsAddingGoal(false);
    setGoalForm({
      goal_description: g.goal_description,
      goal_race_name: g.goal_race_name,
      goal_race_date: g.goal_race_date,
      goal_target_time: g.goal_target_time,
      weekly_training_hours: g.weekly_training_hours,
      is_active: g.is_active,
    });
  }

  function startAddGoal() {
    setEditingGoalId(null);
    setIsAddingGoal(true);
    setGoalForm(EMPTY_GOAL);
  }

  function cancelGoalForm() {
    setEditingGoalId(null);
    setIsAddingGoal(false);
    setGoalForm(EMPTY_GOAL);
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

          {/* Training Goals Manager */}
          <div className="card animate-fade-in" style={{ marginBottom: "var(--space-4)" }} id="settings-goals">
            <div className="card-header" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <div>
                <div className="card-title" style={{ fontSize: "var(--text-base)" }}>Training Goals</div>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "4px" }}>
                  Manage multiple training goals — the AI coach will customize briefings and load recommendations accordingly.
                </p>
              </div>
              {!isAddingGoal && !editingGoalId && (
                <button className="btn btn-secondary btn-sm" onClick={startAddGoal}>
                  + Add Goal
                </button>
              )}
            </div>

            {/* List of Goals */}
            {!isAddingGoal && !editingGoalId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                {goalsLoading ? (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", textAlign: "center", padding: "var(--space-4)" }}>
                    Loading goals…
                  </p>
                ) : goals.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "var(--space-6) var(--space-4)", border: "1px dashed var(--border-color)", borderRadius: "var(--radius-md)" }}>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
                      No training goals configured yet. Setup your first goal to receive customized AI coach advice.
                    </p>
                    <button className="btn className=btn-primary btn-sm" onClick={startAddGoal}>
                      Configure Training Goal
                    </button>
                  </div>
                ) : (
                  goals.map((g) => {
                    const daysLeft = daysUntil(g.goal_race_date);
                    const raceState = goalRaceState(g.goal_race_date);
                    const isFrozen = g.is_active && (raceState === "recovery" || raceState === "expired");
                    const daysSinceRace = daysLeft !== null && daysLeft < 0 ? Math.abs(daysLeft) : null;

                    return (
                      <div
                        key={g.id}
                        style={{
                          border: `1px solid ${
                            isFrozen ? "rgba(139,149,168,0.3)" : "var(--border-color)"
                          }`,
                          borderRadius: "var(--radius-md)",
                          padding: "var(--space-4)",
                          background: isFrozen
                            ? "rgba(139,149,168,0.06)"
                            : g.is_active
                            ? "var(--color-bg-secondary)"
                            : "var(--color-bg-tertiary)",
                          opacity: isFrozen ? 0.82 : g.is_active ? 1 : 0.7,
                          transition: "all var(--transition-fast)",
                          position: "relative",
                        }}
                      >
                        {/* Frozen overlay label for recovery/expired goals */}
                        {isFrozen && (
                          <div style={{
                            position: "absolute",
                            top: "var(--space-2)",
                            right: "var(--space-2)",
                            fontSize: "10px",
                            color: "var(--color-text-muted)",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontWeight: 600,
                          }}>
                            🔒 Read-only
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                              <h4 style={{
                                fontSize: "var(--text-base)",
                                fontWeight: "var(--weight-semibold)",
                                color: isFrozen ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                              }}>
                                {g.goal_race_name || "General Fitness Goal"}
                              </h4>

                              {/* Active/Archived status badge — only for non-frozen goals */}
                              {!isFrozen && (
                                <span
                                  className="badge"
                                  style={{
                                    background: g.is_active ? "rgba(0,0,0,0.05)" : "var(--color-bg-secondary)",
                                    color: g.is_active ? "var(--color-success)" : "var(--color-text-muted)",
                                    border: "1px solid var(--border-color)",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => g.id && toggleActive(g.id)}
                                >
                                  {g.is_active ? "Active" : "Archived"}
                                </span>
                              )}

                              {/* Recovery Mode badge */}
                              {g.is_active && raceState === "recovery" && (
                                <span
                                  className="badge"
                                  style={{
                                    background: "rgba(99,102,241,0.1)",
                                    color: "#818cf8",
                                    border: "1px solid rgba(99,102,241,0.25)",
                                  }}
                                  title="AI can still access this goal for post-race recovery planning for up to 30 days after the race."
                                >
                                  🏁 Recovery Mode
                                </span>
                              )}

                              {/* Expired badge */}
                              {g.is_active && raceState === "expired" && (
                                <span
                                  className="badge"
                                  style={{
                                    background: "rgba(107,114,128,0.1)",
                                    color: "var(--color-text-muted)",
                                    border: "1px solid rgba(107,114,128,0.2)",
                                  }}
                                  title="Race was over 30 days ago. AI no longer uses this goal. Archive or delete it to clean up."
                                >
                                  Expired
                                </span>
                              )}

                              {/* Countdown badge for upcoming races */}
                              {g.is_active && raceState === "upcoming" && g.goal_race_date && daysLeft !== null && (
                                <span
                                  className="badge"
                                  style={{
                                    background: daysLeft <= 30 ? "rgba(245,158,11,0.12)" : "rgba(52,211,153,0.1)",
                                    color: daysLeft <= 30 ? "#d97706" : "var(--color-success)",
                                    border: `1px solid ${daysLeft <= 30 ? "#f59e0b44" : "rgba(52,211,153,0.2)"}`,
                                  }}
                                >
                                  {daysLeft}d to race
                                </span>
                              )}
                            </div>

                            <div style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                              gap: "var(--space-2)",
                              marginTop: "var(--space-2)",
                              fontSize: "var(--text-sm)",
                              color: "var(--color-text-secondary)",
                            }}>
                              {g.goal_race_date && (
                                <div>
                                  <span style={{ color: "var(--color-text-muted)" }}>Date:</span>{" "}
                                  {g.goal_race_date}
                                  {daysSinceRace !== null && (
                                    <span style={{ color: "var(--color-text-muted)", marginLeft: 4, fontSize: "var(--text-xs)" }}>
                                      ({daysSinceRace}d ago)
                                    </span>
                                  )}
                                </div>
                              )}
                              {g.goal_target_time && (
                                <div>
                                  <span style={{ color: "var(--color-text-muted)" }}>Target Time:</span> {g.goal_target_time}
                                </div>
                              )}
                              {g.weekly_training_hours && (
                                <div>
                                  <span style={{ color: "var(--color-text-muted)" }}>Weekly Target:</span> {g.weekly_training_hours}h
                                </div>
                              )}
                            </div>

                            {/* Recovery window info note */}
                            {g.is_active && raceState === "recovery" && (
                              <p style={{
                                fontSize: "var(--text-xs)",
                                color: "#818cf8",
                                marginTop: "var(--space-2)",
                                padding: "var(--space-2) var(--space-3)",
                                background: "rgba(99,102,241,0.07)",
                                borderRadius: "var(--radius-sm)",
                                borderLeft: "2px solid rgba(99,102,241,0.4)",
                              }}>
                                AI coach will use this goal for post-race recovery planning until 30 days after the race date. Archive or delete when done.
                              </p>
                            )}

                            {g.is_active && raceState === "expired" && (
                              <p style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--color-text-muted)",
                                marginTop: "var(--space-2)",
                                padding: "var(--space-2) var(--space-3)",
                                background: "rgba(107,114,128,0.07)",
                                borderRadius: "var(--radius-sm)",
                                borderLeft: "2px solid rgba(107,114,128,0.3)",
                              }}>
                                Race was over 30 days ago — AI no longer includes this goal in its context. Archive or delete to clean up.
                              </p>
                            )}

                            {g.goal_description && (
                              <p style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--color-text-secondary)",
                                marginTop: "var(--space-3)",
                                borderTop: "1px dashed var(--border-color)",
                                paddingTop: "var(--space-2)",
                                fontStyle: "italic",
                              }}>
                                &ldquo;{g.goal_description}&rdquo;
                              </p>
                            )}
                          </div>

                          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexShrink: 0 }}>
                            {/* Hide Edit/Activate for frozen goals — they're read-only for AI recovery */}
                            {!isFrozen && (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => startEditGoal(g)}
                                  style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => g.id && toggleActive(g.id)}
                                  style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}
                                >
                                  {g.is_active ? "Archive" : "Activate"}
                                </button>
                              </>
                            )}
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => g.id && deleteGoal(g.id)}
                              style={{ padding: "4px 8px", fontSize: "var(--text-xs)" }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Add or Edit Form */}
            {(isAddingGoal || editingGoalId) && (
              <form onSubmit={(e) => { e.preventDefault(); saveGoal(); }} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", border: "1px solid var(--border-color)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)" }}>
                <h3 style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-2)" }}>
                  {editingGoalId ? "Edit Training Goal" : "Add New Training Goal"}
                </h3>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                  <div>
                    <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                      Target Race / Event Name
                    </label>
                    <input
                      type="text"
                      className="chat-input"
                      style={{ fontSize: "var(--text-sm)", width: "100%" }}
                      placeholder="e.g. Boston Marathon"
                      value={goalForm.goal_race_name}
                      onChange={(e) => setGoalForm((g) => ({ ...g, goal_race_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                      Race Date
                    </label>
                    <input
                      type="date"
                      className="chat-input"
                      style={{ fontSize: "var(--text-sm)", width: "100%" }}
                      value={goalForm.goal_race_date}
                      onChange={(e) => setGoalForm((g) => ({ ...g, goal_race_date: e.target.value }))}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                  <div>
                    <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                      Goal Finish Time
                    </label>
                    <input
                      type="text"
                      className="chat-input"
                      style={{ fontSize: "var(--text-sm)", width: "100%" }}
                      placeholder="e.g. 3:59:00"
                      value={goalForm.goal_target_time}
                      onChange={(e) => setGoalForm((g) => ({ ...g, goal_target_time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                      Weekly Training Hours Target
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="40"
                      step="0.5"
                      className="chat-input"
                      style={{ fontSize: "var(--text-sm)", width: "100%" }}
                      placeholder="e.g. 10"
                      value={goalForm.weekly_training_hours}
                      onChange={(e) => setGoalForm((g) => ({ ...g, weekly_training_hours: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", display: "block", marginBottom: "4px" }}>
                    Additional Notes for AI Coach
                  </label>
                  <textarea
                    className="chat-input"
                    rows={3}
                    style={{ fontSize: "var(--text-sm)", resize: "vertical", fontFamily: "inherit", width: "100%" }}
                    placeholder="e.g. First marathon, prone to runner's knee, want pacing advice."
                    value={goalForm.goal_description}
                    onChange={(e) => setGoalForm((g) => ({ ...g, goal_description: e.target.value }))}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <input
                    type="checkbox"
                    id="goal-active-checkbox"
                    checked={goalForm.is_active}
                    onChange={(e) => setGoalForm((g) => ({ ...g, is_active: e.target.checked }))}
                    style={{ cursor: "pointer" }}
                  />
                  <label htmlFor="goal-active-checkbox" style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                    Keep this training goal active
                  </label>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                  <button type="submit" className="btn btn-primary" disabled={goalSaving}>
                    {goalSaving ? "Saving…" : "Save Goal"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={cancelGoalForm}>
                    Cancel
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
              </form>
            )}
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
