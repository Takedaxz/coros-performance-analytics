"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import type { SyncStatus } from "@/lib/types";

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
  training_notes: string;
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
  training_notes: "",
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
  const [mcpStatus, setMcpStatus] = useState<{ connected: boolean; expired?: boolean } | null>(null);
  const [mcpConnecting, setMcpConnecting] = useState(false);
  
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

  // COROS Account Credentials state
  const [corosCredStatus, setCorosCredStatus] = useState<{ configured: boolean; email?: string | null; source?: string | null } | null>(null);
  const [corosEmailInput, setCorosEmailInput] = useState("");
  const [corosPasswordInput, setCorosPasswordInput] = useState("");
  const [corosSaving, setCorosSaving] = useState(false);
  const [corosSaved, setCorosSaved] = useState(false);
  const [corosError, setCorosError] = useState("");

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
            training_notes: data.training_notes ?? "",
          });
        }
      } catch {}
    }

    async function fetchMcpStatus() {
      try {
        const res = await fetch(`${apiBase}/auth/coros-mcp/status`);
        if (res.ok) setMcpStatus(await res.json());
      } catch {
        // Backend not available
      }
    }

    async function fetchCorosCreds() {
      try {
        const res = await fetch(`${apiBase}/api/settings/coros-credentials`);
        if (res.ok) {
          const data = await res.json();
          setCorosCredStatus(data);
          if (data.email) setCorosEmailInput(data.email);
        }
      } catch {
        // Backend not available
      }
    }

    fetchConfig();
    fetchGoals();
    fetchProfile();
    fetchMcpStatus();
    fetchCorosCreds();
  }, [apiBase]);

  async function saveCorosCreds() {
    if (!corosEmailInput.trim() || !corosPasswordInput) {
      setCorosError("Please enter both email and password.");
      return;
    }
    setCorosSaving(true);
    setCorosError("");
    setCorosSaved(false);
    try {
      const res = await fetch(`${apiBase}/api/settings/coros-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: corosEmailInput.trim(),
          password: corosPasswordInput,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      setCorosSaved(true);
      setCorosPasswordInput("");
      setTimeout(() => setCorosSaved(false), 3000);

      // Refresh status
      const resCreds = await fetch(`${apiBase}/api/settings/coros-credentials`);
      if (resCreds.ok) setCorosCredStatus(await resCreds.json());

      const resSync = await fetch(`${apiBase}/api/sync/status`);
      if (resSync.ok) setSyncConfig(await resSync.json());
    } catch (err) {
      setCorosError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setCorosSaving(false);
    }
  }

  async function deleteCorosCreds() {
    if (!confirm("Are you sure you want to remove your stored COROS credentials?")) return;
    try {
      await fetch(`${apiBase}/api/settings/coros-credentials`, { method: "DELETE" });
      setCorosEmailInput("");
      setCorosPasswordInput("");
      setCorosCredStatus({ configured: false, email: null });

      const resSync = await fetch(`${apiBase}/api/sync/status`);
      if (resSync.ok) setSyncConfig(await resSync.json());
    } catch {}
  }

  async function connectMcp() {
    setMcpConnecting(true);
    const popup = window.open(`${apiBase}/auth/coros-mcp/connect`, "_blank", "width=540,height=780");
    // Poll status after popup closes or after 60 s
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/auth/coros-mcp/status`);
        if (res.ok) {
          const data = await res.json();
          setMcpStatus(data);
          if (data.connected) {
            clearInterval(poll);
            setMcpConnecting(false);
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    setTimeout(() => { clearInterval(poll); setMcpConnecting(false); }, 120_000);
    if (popup) popup.addEventListener("close", () => clearInterval(poll));
  }

  async function disconnectMcp() {
    await fetch(`${apiBase}/auth/coros-mcp`, { method: "DELETE" });
    setMcpStatus({ connected: false });
  }

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
          training_notes: profile.training_notes || null,
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
        <div className="page-body settings-page">
          <div className="settings-sections">
              <section className="settings-section" id="settings-connections">
                <div className="settings-section-heading">
                  <div>
                    <h2>Connections</h2>
                    <p>Two separate COROS connections keep activity metrics and detailed sleep stages current.</p>
                  </div>
                </div>

                <div className="settings-connection-row" id="settings-sync">
                  <div className="settings-connection-main">
                    <div className="settings-title-line">
                      <h3>COROS account</h3>
                      <span className={`settings-state ${corosCredStatus?.configured ? "is-connected" : ""}`}>
                        {corosCredStatus?.configured ? "Connected" : "Not configured"}
                      </span>
                    </div>
                    <p>Activity history, fitness metrics, and recovery data.</p>
                    {corosCredStatus?.configured && (
                      <div className="settings-account-detail">
                        <strong>{corosCredStatus.email}</strong>
                      </div>
                    )}
                  </div>
                  {corosCredStatus?.configured ? (
                    <button className="btn btn-secondary btn-sm settings-danger-action" onClick={deleteCorosCreds}>
                      Disconnect
                    </button>
                  ) : (
                    <form className="settings-credential-form" onSubmit={(e) => { e.preventDefault(); saveCorosCreds(); }}>
                      <div className="settings-form-grid">
                        <div className="settings-field">
                          <label htmlFor="coros-email">COROS email</label>
                          <input
                            id="coros-email"
                            type="email"
                            placeholder="you@example.com"
                            value={corosEmailInput}
                            onChange={(e) => setCorosEmailInput(e.target.value)}
                            required
                          />
                        </div>
                        <div className="settings-field">
                          <label htmlFor="coros-password">Password</label>
                          <input
                            id="coros-password"
                            type="password"
                            placeholder="Enter your password"
                            value={corosPasswordInput}
                            onChange={(e) => setCorosPasswordInput(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <div className="settings-actions">
                        <button type="submit" className="btn btn-primary" disabled={corosSaving}>
                          {corosSaving ? "Saving…" : "Connect account"}
                        </button>
                        {corosSaved && <span className="settings-feedback is-success">Credentials saved securely.</span>}
                        {corosError && <span className="settings-feedback is-error">{corosError}</span>}
                      </div>
                    </form>
                  )}
                </div>

                <div className="settings-connection-row" id="settings-coros-mcp">
                  <div className="settings-connection-main">
                    <div className="settings-title-line">
                      <h3>Detailed sleep stages</h3>
                      <span className={`settings-state ${mcpStatus?.connected && !mcpStatus.expired ? "is-connected" : mcpStatus?.expired ? "is-warning" : ""}`}>
                        {mcpStatus?.connected ? (mcpStatus.expired ? "Authorization expired" : "Connected") : "Not connected"}
                      </span>
                    </div>
                    <p>Deep, light, and REM stages sync through COROS MCP.</p>
                  </div>
                  {mcpStatus?.connected && !mcpStatus.expired ? (
                    <button id="settings-coros-mcp-disconnect" className="btn btn-secondary btn-sm settings-danger-action" onClick={disconnectMcp}>
                      Disconnect
                    </button>
                  ) : (
                    <button id="settings-coros-mcp-connect" className="btn btn-primary btn-sm" onClick={connectMcp} disabled={mcpConnecting}>
                      {mcpConnecting ? "Waiting for COROS…" : "Connect sleep data"}
                    </button>
                  )}
                </div>

                <div className="settings-sync-facts">
                  <div>
                    <span>Last successful sync</span>
                    <strong>{syncConfig?.last_sync_at ? new Date(syncConfig.last_sync_at).toLocaleString() : "Never"}</strong>
                  </div>
                  <div>
                    <span>Background interval</span>
                    <strong>Every {syncConfig?.sync_interval_minutes || 15} minutes</strong>
                  </div>
                </div>
              </section>

              <section className="settings-section" id="settings-profile">
                <div className="settings-section-heading">
                  <div>
                    <h2>Athlete profile</h2>
                    <p>Biometrics improve training zones, energy estimates, and recovery analysis.</p>
                  </div>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); saveProfile(); }}>
                  <div className="settings-form-grid is-three-column">
                    <div className="settings-field">
                      <label htmlFor="profile-first-name">First name</label>
                      <input id="profile-first-name" type="text" placeholder="John" value={profile.first_name} onChange={(e) => setProfile((p) => ({ ...p, first_name: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-last-name">Last name</label>
                      <input id="profile-last-name" type="text" placeholder="Doe" value={profile.last_name} onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-nickname">Display name</label>
                      <input id="profile-nickname" type="text" placeholder="Johnny" value={profile.nickname} onChange={(e) => setProfile((p) => ({ ...p, nickname: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-birthdate">Birthdate</label>
                      <input id="profile-birthdate" type="date" value={profile.birthdate} onChange={(e) => setProfile((p) => ({ ...p, birthdate: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-height">Height <span>cm</span></label>
                      <input id="profile-height" type="number" min="50" max="300" placeholder="180" value={profile.height_cm} onChange={(e) => setProfile((p) => ({ ...p, height_cm: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-weight">Weight <span>kg</span></label>
                      <input id="profile-weight" type="number" min="20" max="300" step="0.1" placeholder="75.5" value={profile.weight_kg} onChange={(e) => setProfile((p) => ({ ...p, weight_kg: e.target.value }))} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-body-fat">Body fat <span>%</span></label>
                      <input id="profile-body-fat" type="number" min="1" max="80" step="0.1" placeholder="15.0" value={profile.body_fat_pct} onChange={(e) => setProfile((p) => ({ ...p, body_fat_pct: e.target.value }))} />
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                      {profileSaving ? "Saving…" : "Save profile"}
                    </button>
                    {profileSaved && <span className="settings-feedback is-success">Profile saved.</span>}
                    {profileError && <span className="settings-feedback is-error">{profileError}</span>}
                  </div>
                </form>
              </section>

              <section className="settings-section" id="settings-coaching">
                <div className="settings-section-heading">
                  <div>
                    <h2>Coaching context</h2>
                    <p>Define the outcomes and constraints the coach should consider in every recommendation.</p>
                  </div>
                </div>

                <div className="settings-subsection" id="settings-goals">
                  <div className="settings-subsection-heading">
                    <div>
                      <h3>Training goals</h3>
                      <p>Upcoming races, target times, and weekly training capacity.</p>
                    </div>
                    {!isAddingGoal && !editingGoalId && (
                      <button className="btn btn-secondary btn-sm" onClick={startAddGoal}>Add goal</button>
                    )}
                  </div>

                  {!isAddingGoal && !editingGoalId && (
                    <div className="settings-goal-list">
                      {goalsLoading ? (
                        <p className="settings-empty">Loading goals…</p>
                      ) : goals.length === 0 ? (
                        <div className="settings-empty">
                          <strong>No training goal yet</strong>
                          <span>Add a race or fitness target to focus coaching advice.</span>
                          <button className="btn btn-secondary btn-sm" onClick={startAddGoal}>Configure first goal</button>
                        </div>
                      ) : (
                        [...goals]
                          .sort((a, b) => {
                            if (!a.goal_race_date && !b.goal_race_date) return 0;
                            if (!a.goal_race_date) return 1;
                            if (!b.goal_race_date) return -1;
                            return a.goal_race_date.localeCompare(b.goal_race_date);
                          })
                          .map((g) => {
                            const daysLeft = daysUntil(g.goal_race_date);
                            const raceState = goalRaceState(g.goal_race_date);
                            const isFrozen = g.is_active && (raceState === "recovery" || raceState === "expired");
                            return (
                              <article className={`settings-goal ${g.is_active ? "" : "is-archived"}`} key={g.id}>
                                <div>
                                  <div className="settings-title-line">
                                    <h4>{g.goal_race_name || "General fitness goal"}</h4>
                                    <span className={`settings-state ${g.is_active && raceState !== "expired" ? "is-connected" : ""}`}>
                                      {raceState === "recovery" ? "Recovery" : raceState === "expired" ? "Expired" : g.is_active ? "Active" : "Archived"}
                                    </span>
                                    {g.is_active && raceState === "upcoming" && daysLeft !== null && (
                                      <span className={`settings-state ${daysLeft <= 30 ? "is-warning" : ""}`}>{daysLeft} days</span>
                                    )}
                                  </div>
                                  <div className="settings-goal-meta">
                                    {g.goal_race_date && <span>{g.goal_race_date}</span>}
                                    {g.goal_target_time && <span>Target {g.goal_target_time}</span>}
                                    {g.weekly_training_hours && <span>{g.weekly_training_hours} hr / week</span>}
                                  </div>
                                  {g.goal_description && <p>{g.goal_description}</p>}
                                  {isFrozen && (
                                    <p className="settings-goal-notice">
                                      {raceState === "recovery"
                                        ? "Available to the coach for post-race recovery planning for 30 days."
                                        : "This race is no longer included in coaching context."}
                                    </p>
                                  )}
                                </div>
                                <div className="settings-goal-actions">
                                  {!isFrozen && (
                                    <>
                                      <button className="btn btn-ghost btn-sm" onClick={() => startEditGoal(g)}>Edit</button>
                                      <button className="btn btn-ghost btn-sm" onClick={() => g.id && toggleActive(g.id)}>
                                        {g.is_active ? "Archive" : "Activate"}
                                      </button>
                                    </>
                                  )}
                                  <button className="btn btn-ghost btn-sm settings-danger-action" onClick={() => g.id && deleteGoal(g.id)}>Delete</button>
                                </div>
                              </article>
                            );
                          })
                      )}
                    </div>
                  )}

                  {(isAddingGoal || editingGoalId) && (
                    <form className="settings-goal-form" onSubmit={(e) => { e.preventDefault(); saveGoal(); }}>
                      <div className="settings-subsection-heading">
                        <h3>{editingGoalId ? "Edit training goal" : "New training goal"}</h3>
                      </div>
                      <div className="settings-form-grid">
                        <div className="settings-field">
                          <label htmlFor="goal-name">Race or event</label>
                          <input id="goal-name" type="text" placeholder="Boston Marathon" value={goalForm.goal_race_name} onChange={(e) => setGoalForm((g) => ({ ...g, goal_race_name: e.target.value }))} required />
                        </div>
                        <div className="settings-field">
                          <label htmlFor="goal-date">Race date</label>
                          <input id="goal-date" type="date" value={goalForm.goal_race_date} onChange={(e) => setGoalForm((g) => ({ ...g, goal_race_date: e.target.value }))} />
                        </div>
                        <div className="settings-field">
                          <label htmlFor="goal-time">Target time</label>
                          <input id="goal-time" type="text" placeholder="3:59:00" value={goalForm.goal_target_time} onChange={(e) => setGoalForm((g) => ({ ...g, goal_target_time: e.target.value }))} />
                        </div>
                        <div className="settings-field">
                          <label htmlFor="goal-hours">Weekly training <span>hours</span></label>
                          <input id="goal-hours" type="number" min="0" max="40" step="0.5" placeholder="10" value={goalForm.weekly_training_hours} onChange={(e) => setGoalForm((g) => ({ ...g, weekly_training_hours: e.target.value }))} />
                        </div>
                      </div>
                      <div className="settings-field">
                        <label htmlFor="goal-notes">Goal notes</label>
                        <textarea id="goal-notes" rows={3} placeholder="Experience, injury considerations, or pacing priorities." value={goalForm.goal_description} onChange={(e) => setGoalForm((g) => ({ ...g, goal_description: e.target.value }))} />
                      </div>
                      <label className="settings-check" htmlFor="goal-active-checkbox">
                        <input id="goal-active-checkbox" type="checkbox" checked={goalForm.is_active} onChange={(e) => setGoalForm((g) => ({ ...g, is_active: e.target.checked }))} />
                        <span className="settings-check-control" aria-hidden="true">
                          <svg viewBox="0 0 16 16">
                            <path d="m3.5 8.25 2.75 2.75 6.25-6.25" />
                          </svg>
                        </span>
                        <span>Keep this goal active</span>
                      </label>
                      <div className="settings-actions">
                        <button type="submit" className="btn btn-primary" disabled={goalSaving}>{goalSaving ? "Saving…" : "Save goal"}</button>
                        <button type="button" className="btn btn-secondary" onClick={cancelGoalForm}>Cancel</button>
                        {goalSaved && <span className="settings-feedback is-success">Goal saved.</span>}
                        {goalError && <span className="settings-feedback is-error">{goalError}</span>}
                      </div>
                    </form>
                  )}
                </div>

                <div className="settings-subsection" id="settings-training-notes">
                  <div className="settings-subsection-heading">
                    <div>
                      <h3>Training notes</h3>
                      <p>Persistent constraints such as injury history, rest days, and schedule limits.</p>
                    </div>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="training-notes-input">Notes used in every coach conversation</label>
                    <textarea
                      id="training-notes-input"
                      rows={5}
                      placeholder={"- Rest every Sunday\n- Avoid steep downhill running\n- Maximum 10 hours per week"}
                      value={profile.training_notes}
                      onChange={(e) => setProfile((p) => ({ ...p, training_notes: e.target.value }))}
                    />
                    <span className="settings-help">Use short, factual notes. Do not include information the coach does not need.</span>
                  </div>
                  <div className="settings-actions">
                    <button id="save-training-notes-btn" className="btn btn-primary" onClick={saveProfile} disabled={profileSaving}>
                      {profileSaving ? "Saving…" : "Save notes"}
                    </button>
                    {profileSaved && <span className="settings-feedback is-success">Coaching context saved.</span>}
                    {profileError && <span className="settings-feedback is-error">{profileError}</span>}
                  </div>
                </div>
              </section>

              <section className="settings-section" id="settings-data">
                <div className="settings-section-heading">
                  <div>
                    <h2>Data & storage</h2>
                    <p>Review where your health data is stored and which management tools are available.</p>
                  </div>
                </div>
                <div className="settings-storage">
                  <div><span>Structured data</span><strong>Local PostgreSQL</strong></div>
                  <div><span>Activity source files</span><strong>FIT / TCX file store</strong></div>
                  <div><span>Credential protection</span><strong>AES-256-GCM encryption</strong></div>
                </div>
                <div className="settings-data-actions">
                  <div>
                    <h3>Account data controls</h3>
                    <p>Export and permanent deletion are not available in this build.</p>
                  </div>
                  <div>
                    <button className="btn btn-secondary" id="export-data-btn" disabled>Export all data</button>
                    <button className="btn btn-secondary settings-danger-action" id="delete-data-btn" disabled>Delete all data</button>
                  </div>
                </div>
              </section>
          </div>
        </div>
      </main>
    </div>
  );
}
