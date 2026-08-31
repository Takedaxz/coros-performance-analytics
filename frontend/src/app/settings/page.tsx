"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import SingleSelect from "@/components/SingleSelect";
import NumberStepper from "@/components/NumberStepper";
import CustomDatePicker from "@/components/CustomDatePicker";
import FileUpload from "@/components/FileUpload";
import ThemeToggle from "@/components/ThemeToggle";
import type { SyncStatus } from "@/lib/types";

interface UserGoal {
  id?: string;
  goal_description: string;
  goal_race_name: string;
  goal_race_date: string;
  goal_target_time: string;
  goal_result_time: string;
  goal_race_note: string;
  goal_race_tier: string;
  weekly_training_hours: string;
  is_active?: boolean;
}

interface UserDocument {
  id: string;
  goal_id: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

interface UserProfile {
  first_name: string;
  last_name: string;
  nickname: string;
  birthdate: string;
  sex: string;
  height_cm: string;
  weight_kg: string;
  body_fat_pct: string;
  training_notes: string;
  max_hr_bpm: number | null;
  resting_hr_bpm: number | null;
  heart_rate_reserve_bpm: number | null;
}

const EMPTY_GOAL: UserGoal = {
  goal_description: "",
  goal_race_name: "",
  goal_race_date: "",
  goal_target_time: "",
  goal_result_time: "",
  goal_race_note: "",
  goal_race_tier: "",
  weekly_training_hours: "",
  is_active: true,
};

const EMPTY_PROFILE: UserProfile = {
  first_name: "",
  last_name: "",
  nickname: "",
  birthdate: "",
  sex: "",
  height_cm: "",
  weight_kg: "",
  body_fat_pct: "",
  training_notes: "",
  max_hr_bpm: null,
  resting_hr_bpm: null,
  heart_rate_reserve_bpm: null,
};

function formatDocumentSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return null;
  const bangkokToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(Number(bangkokToday.year), Number(bangkokToday.month) - 1, Number(bangkokToday.day))) /
      86_400_000,
  );
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

function targetTimeParts(value: string): [string, string, string] {
  const [hours = "", minutes = "", seconds = ""] = value.split(":");
  return [hours, minutes, seconds];
}

function updateTargetTime(value: string, index: 0 | 1 | 2, nextValue: string): string {
  const parts = targetTimeParts(value);
  parts[index] = nextValue;
  return parts.join(":");
}

function normalizedTargetTime(value: string): string | null {
  const [hours, minutes, seconds] = targetTimeParts(value);
  if (!hours && !minutes && !seconds) return null;
  return `${Number(hours) || 0}:${String(Number(minutes) || 0).padStart(2, "0")}:${String(Number(seconds) || 0).padStart(2, "0")}`;
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
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [goalFile, setGoalFile] = useState<File | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [previewDocument, setPreviewDocument] = useState<UserDocument | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ label: string; name: string; onConfirm: () => void } | null>(null);

  // Edit/Add forms state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [isAddingGoal, setIsAddingGoal] = useState(false);
  const [goalForm, setGoalForm] = useState<UserGoal>(EMPTY_GOAL);

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");
  const profileLoaded = useRef(false);
  const profileDirty = useRef(false);
  const profileSavedTimer = useRef<number | null>(null);

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
          goal_result_time: item.goal_result_time ?? "",
          goal_race_note: item.goal_race_note ?? "",
          goal_race_tier: item.goal_race_tier ?? "",
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

  async function fetchDocuments() {
    try {
      const res = await fetch(`${apiBase}/api/settings/documents`);
      if (res.ok) setDocuments(await res.json());
    } catch { /* Backend not available */ }
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
            sex: data.sex ?? "",
            height_cm: data.height_cm?.toString() ?? "",
            weight_kg: data.weight_kg?.toString() ?? "",
            body_fat_pct: data.body_fat_pct?.toString() ?? "",
            training_notes: data.training_notes ?? "",
            max_hr_bpm: data.max_hr_bpm ?? null,
            resting_hr_bpm: data.resting_hr_bpm ?? null,
            heart_rate_reserve_bpm: data.heart_rate_reserve_bpm ?? null,
          });
          profileLoaded.current = true;
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
    fetchDocuments();
    fetchProfile();
    fetchMcpStatus();
    fetchCorosCreds();
    const syncStatusTimer = window.setInterval(fetchConfig, 60_000);
    return () => window.clearInterval(syncStatusTimer);
  }, [apiBase]);

  async function uploadDocument(file: File, goalId?: string) {
    setDocumentError("");
    const body = new FormData();
    body.append("file", file);
    if (goalId) body.append("goal_id", goalId);
    try {
      const res = await fetch(`${apiBase}/api/settings/documents`, { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      const document = await res.json();
      setDocuments((current) => [document, ...current]);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : "Failed to upload document");
    }
  }

  async function deleteDocument(id: string, filename: string) {
    setConfirmDelete({
      label: "Delete this document?",
      name: filename,
      onConfirm: async () => {
        const res = await fetch(`${apiBase}/api/settings/documents/${id}`, { method: "DELETE" });
        if (res.ok) setDocuments((current) => current.filter((document) => document.id !== id));
      },
    });
  }

  useEffect(() => {
    if (!profileLoaded.current || !profileDirty.current) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProfileSaving(true);
      try {
        const res = await fetch(`${apiBase}/api/settings/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: profile.first_name || null,
            last_name: profile.last_name || null,
            nickname: profile.nickname || null,
            birthdate: profile.birthdate || null,
            sex: profile.sex || null,
            height_cm: profile.height_cm ? parseFloat(profile.height_cm) : null,
            weight_kg: profile.weight_kg ? parseFloat(profile.weight_kg) : null,
            body_fat_pct: profile.body_fat_pct ? parseFloat(profile.body_fat_pct) : null,
            training_notes: profile.training_notes || null,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setProfileSaved(true);
        profileSavedTimer.current = window.setTimeout(() => setProfileSaved(false), 3000);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setProfileError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        if (!controller.signal.aborted) setProfileSaving(false);
      }
    }, 600);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiBase, profile]);

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
    const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const popup = window.open(`${apiBase}/auth/coros-mcp/connect?theme=${theme}`, "_blank", "width=540,height=780");
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
      goal_target_time: normalizedTargetTime(goalForm.goal_target_time),
      goal_result_time: normalizedTargetTime(goalForm.goal_result_time),
      goal_race_note: goalForm.goal_race_note || null,
      goal_race_tier: goalForm.goal_race_tier || null,
      weekly_training_hours: goalForm.weekly_training_hours
        ? parseFloat(goalForm.weekly_training_hours)
        : null,
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
      const savedGoal = await res.json();
      if (goalFile && savedGoal.id) await uploadDocument(goalFile, savedGoal.id);
      setGoalSaved(true);
      setTimeout(() => setGoalSaved(false), 3000);

      // Reset states
      setEditingGoalId(null);
      setIsAddingGoal(false);
      setGoalForm(EMPTY_GOAL);
      setGoalFile(null);
      
      await fetchGoals();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setGoalSaving(false);
    }
  }

  async function deleteGoal(id: string, raceName: string) {
    setConfirmDelete({
      label: "Delete this training goal?",
      name: raceName,
      onConfirm: async () => {
        setGoalError("");
        try {
          const res = await fetch(`${apiBase}/api/settings/goals/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await fetchGoals();
        } catch (err) {
          setGoalError(err instanceof Error ? err.message : "Failed to delete");
        }
      },
    });
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
      goal_result_time: g.goal_result_time,
      goal_race_note: g.goal_race_note,
      goal_race_tier: g.goal_race_tier,
      weekly_training_hours: g.weekly_training_hours,
      is_active: g.is_active,
    });
    setGoalFile(null);
  }

  function startAddGoal() {
    setEditingGoalId(null);
    setIsAddingGoal(true);
    setGoalForm(EMPTY_GOAL);
    setGoalFile(null);
  }

  function cancelGoalForm() {
    setEditingGoalId(null);
    setIsAddingGoal(false);
    setGoalForm(EMPTY_GOAL);
    setGoalFile(null);
  }

  function updateProfileField<Key extends keyof UserProfile>(key: Key, value: UserProfile[Key]) {
    if (profileSavedTimer.current !== null) window.clearTimeout(profileSavedTimer.current);
    profileDirty.current = true;
    setProfileError("");
    setProfileSaved(false);
    setProfile((current) => ({ ...current, [key]: value }));
  }

  const [targetHours, targetMinutes, targetSeconds] = targetTimeParts(goalForm.goal_target_time);
  const [resultHours, resultMinutes, resultSeconds] = targetTimeParts(goalForm.goal_result_time);
  const canEnterGoalResult = Boolean(goalForm.goal_race_date)
    && goalRaceState(goalForm.goal_race_date) !== "upcoming";
  const savedMessage = profileSaving
    ? "Saving changes…"
    : corosSaved
    ? "Credentials saved securely."
    : goalSaved
      ? "Goal saved."
      : profileSaved
        ? "Changes saved."
        : "";

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {savedMessage && (
          <div className="sync-toast" role="status" aria-live="polite">
            {savedMessage}
          </div>
        )}
        <header className="page-header">
          <PageTitle>Settings</PageTitle>
          <div className="settings-header-actions">
            <ThemeToggle showLabel={false} className="settings-theme-toggle" />
          </div>
        </header>
        <div className="page-body settings-page">
          <div className="settings-sections">
              <section className="settings-section hover-card" id="settings-connections">
                <div className="settings-section-heading">
                  <div>
                    <h2>Connections</h2>
                    <p>COROS connections keep activity metrics and detailed sleep stages current.</p>
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
                        {corosError && <span className="settings-feedback is-error">{corosError}</span>}
                      </div>
                    </form>
                  )}
                </div>

                <div className="settings-connection-row" id="settings-coros-mcp">
                  <div className="settings-connection-main">
                    <div className="settings-title-line">
                      <h3>COROS MCP</h3>
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
                    <strong>
                      {syncConfig?.last_sync_at && syncConfig.last_sync_at !== "never"
                        ? new Date(syncConfig.last_sync_at).toLocaleString(undefined, {
                            timeZone: "Asia/Bangkok",
                            timeZoneName: "short",
                          })
                        : "Never"}
                    </strong>
                  </div>
                  <div>
                    <span>Background interval</span>
                    <strong>Every {syncConfig?.sync_interval_minutes || 15} minutes</strong>
                  </div>
                </div>
              </section>

              <section className="settings-section hover-card" id="settings-profile">
                <div className="settings-section-heading">
                  <div>
                    <h2>Athlete profile</h2>
                    <p>Biometrics improve training zones, energy estimates, and recovery analysis. Changes save automatically.</p>
                  </div>
                </div>

                <div>
                  <div className="settings-form-grid is-three-column">
                    <div className="settings-field">
                      <label htmlFor="profile-first-name">First name</label>
                      <input id="profile-first-name" type="text" placeholder="John" value={profile.first_name} onChange={(e) => updateProfileField("first_name", e.target.value)} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-last-name">Last name</label>
                      <input id="profile-last-name" type="text" placeholder="Doe" value={profile.last_name} onChange={(e) => updateProfileField("last_name", e.target.value)} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-nickname">Display name</label>
                      <input id="profile-nickname" type="text" placeholder="Johnny" value={profile.nickname} onChange={(e) => updateProfileField("nickname", e.target.value)} />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-birthdate">Birthdate</label>
                      <CustomDatePicker
                        id="profile-birthdate"
                        value={profile.birthdate}
                        onChange={(val) => updateProfileField("birthdate", val)}
                        placeholder="Select birthdate"
                      />
                    </div>
                    <div className="settings-field" style={{ gridColumn: "span 2" }}>
                      <label id="profile-sex-label">Sex</label>
                      <SingleSelect
                        ariaLabel="Sex"
                        id="profile-sex"
                        value={profile.sex}
                        options={[
                          ...(!profile.sex ? [{ value: "", label: "Select sex" }] : []),
                          { value: "female", label: "Female" },
                          { value: "male", label: "Male" },
                        ]}
                        onChange={(sex) => updateProfileField("sex", sex)}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-height">Height <span>cm</span></label>
                      <NumberStepper
                        ariaLabel="Height in centimeters"
                        id="profile-height"
                        min={50}
                        max={300}
                        placeholder="180"
                        value={profile.height_cm}
                        onChange={(heightCm) => updateProfileField("height_cm", heightCm)}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-weight">Weight <span>kg</span></label>
                      <NumberStepper
                        ariaLabel="Weight in kilograms"
                        id="profile-weight"
                        min={20}
                        max={300}
                        step={0.1}
                        placeholder="75.5"
                        value={profile.weight_kg}
                        onChange={(weightKg) => updateProfileField("weight_kg", weightKg)}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="profile-body-fat">Body fat <span>%</span></label>
                      <NumberStepper
                        ariaLabel="Body fat percentage"
                        id="profile-body-fat"
                        min={1}
                        max={80}
                        step={0.1}
                        placeholder="15.0"
                        value={profile.body_fat_pct}
                        onChange={(bodyFatPct) => updateProfileField("body_fat_pct", bodyFatPct)}
                      />
                    </div>
                  </div>
                  <div className="settings-sync-facts">
                    <div>
                      <span>Max heart rate</span>
                      <strong>{profile.max_hr_bpm ?? "--"} bpm</strong>
                    </div>
                    <div>
                      <span>Resting heart rate</span>
                      <strong>{profile.resting_hr_bpm ?? "--"} bpm</strong>
                    </div>
                    <div>
                      <span>Heart rate reserve</span>
                      <strong>{profile.heart_rate_reserve_bpm ?? "--"} bpm</strong>
                    </div>
                  </div>
                  {profileError && <p className="settings-feedback is-error">{profileError}</p>}
                </div>
              </section>

              <section className="settings-section hover-card" id="settings-coaching">
                <div className="settings-section-heading">
                  <div>
                    <h2>Race & training details</h2>
                    <p>Keep your race goals, training notes, and important documents together.</p>
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
                          <CustomDatePicker
                            id="goal-date"
                            value={goalForm.goal_race_date}
                            onChange={(val) => setGoalForm((g) => ({ ...g, goal_race_date: val }))}
                            placeholder="Select race date"
                          />
                        </div>
                        <div className="settings-field settings-goal-tier">
                          <label htmlFor="goal-tier">Race tier</label>
                          <SingleSelect
                            id="goal-tier"
                            ariaLabel="Race tier"
                            value={goalForm.goal_race_tier}
                            onChange={(goal_race_tier) => setGoalForm((goal) => ({ ...goal, goal_race_tier }))}
                            options={[
                              { value: "", label: "Not set" },
                              { value: "A", label: "A — Primary race" },
                              { value: "B", label: "B — Important race" },
                              { value: "C", label: "C — Supporting race" },
                              { value: "D", label: "D — Training race" },
                              { value: "E", label: "E — Low priority" },
                            ]}
                          />
                        </div>
                        <div className="settings-field settings-goal-target-time">
                          <label id="goal-time-label">Target time</label>
                          <div className="settings-target-time" aria-labelledby="goal-time-label">
                            <div className="settings-target-time-part">
                              <span>Hours</span>
                              <NumberStepper
                                ariaLabel="Target hours"
                                id="goal-time-hours"
                                min={0}
                                max={99}
                                placeholder="0"
                                value={targetHours}
                                onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_target_time: updateTargetTime(goal.goal_target_time, 0, value) }))}
                              />
                            </div>
                            <div className="settings-target-time-part">
                              <span>Minutes</span>
                              <NumberStepper
                                ariaLabel="Target minutes"
                                id="goal-time-minutes"
                                min={0}
                                max={59}
                                placeholder="00"
                                value={targetMinutes}
                                onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_target_time: updateTargetTime(goal.goal_target_time, 1, value) }))}
                              />
                            </div>
                            <div className="settings-target-time-part">
                              <span>Seconds</span>
                              <NumberStepper
                                ariaLabel="Target seconds"
                                id="goal-time-seconds"
                                min={0}
                                max={59}
                                placeholder="00"
                                value={targetSeconds}
                                onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_target_time: updateTargetTime(goal.goal_target_time, 2, value) }))}
                              />
                            </div>
                          </div>
                        </div>
                        {canEnterGoalResult && (
                          <div className="settings-field">
                            <label id="goal-result-time-label">Actual result time</label>
                            <div className="settings-target-time" aria-labelledby="goal-result-time-label">
                              <div className="settings-target-time-part">
                                <span>Hours</span>
                                <NumberStepper
                                  ariaLabel="Actual result hours"
                                  id="goal-result-hours"
                                  min={0}
                                  max={99}
                                  placeholder="0"
                                  value={resultHours}
                                  onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_result_time: updateTargetTime(goal.goal_result_time, 0, value) }))}
                                />
                              </div>
                              <div className="settings-target-time-part">
                                <span>Minutes</span>
                                <NumberStepper
                                  ariaLabel="Actual result minutes"
                                  id="goal-result-minutes"
                                  min={0}
                                  max={59}
                                  placeholder="00"
                                  value={resultMinutes}
                                  onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_result_time: updateTargetTime(goal.goal_result_time, 1, value) }))}
                                />
                              </div>
                              <div className="settings-target-time-part">
                                <span>Seconds</span>
                                <NumberStepper
                                  ariaLabel="Actual result seconds"
                                  id="goal-result-seconds"
                                  min={0}
                                  max={59}
                                  placeholder="00"
                                  value={resultSeconds}
                                  onChange={(value) => setGoalForm((goal) => ({ ...goal, goal_result_time: updateTargetTime(goal.goal_result_time, 2, value) }))}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="settings-field">
                          <label htmlFor="goal-hours">Weekly training</label>
                          <div className="settings-target-time-part">
                            <span>Hours</span>
                            <NumberStepper
                              ariaLabel="Weekly training hours"
                              id="goal-hours"
                              min={0}
                              max={40}
                              step={0.5}
                              placeholder="10"
                              value={goalForm.weekly_training_hours}
                              onChange={(weekly_training_hours) => setGoalForm((goal) => ({ ...goal, weekly_training_hours }))}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="settings-field">
                        <label htmlFor="goal-notes">Goal notes</label>
                        <textarea id="goal-notes" rows={3} placeholder="Experience, injury considerations, or pacing priorities." value={goalForm.goal_description} onChange={(e) => setGoalForm((g) => ({ ...g, goal_description: e.target.value }))} />
                      </div>
                      <div className="settings-field">
                        <label htmlFor="goal-document">Race ticket or confirmation</label>
                        <FileUpload id="goal-document" value={goalFile} accept="image/*,application/pdf" helper="Optional image or PDF, up to 20 MB." buttonLabel="Choose file" onChange={setGoalFile} />
                        {editingGoalId && documents.filter((document) => document.goal_id === editingGoalId).map((document) => (
                          <button className="settings-document-link" type="button" key={document.id} onClick={() => setPreviewDocument(document)}>
                            <PaperclipIcon />
                            {document.original_filename}
                          </button>
                        ))}
                      </div>
                      {canEnterGoalResult && (
                        <div className="settings-field">
                          <label htmlFor="goal-race-notes">Race notes</label>
                          <textarea id="goal-race-notes" rows={3} placeholder="How the race went, what worked, and what to improve next time." value={goalForm.goal_race_note} onChange={(e) => setGoalForm((g) => ({ ...g, goal_race_note: e.target.value }))} />
                        </div>
                      )}
                      <div className="settings-actions">
                        <button type="submit" className="btn btn-primary" disabled={goalSaving}>{goalSaving ? "Saving…" : "Save goal"}</button>
                        <button type="button" className="btn btn-secondary" onClick={cancelGoalForm}>Cancel</button>
                        {goalError && <span className="settings-feedback is-error">{goalError}</span>}
                      </div>
                    </form>
                  )}

                  {!editingGoalId && (!isAddingGoal || goals.length > 0) && (
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
                            const isPast = raceState === "recovery" || raceState === "expired";
                            return (
                              <article className={`settings-goal ${!g.is_active || isPast ? "is-archived" : ""}`} key={g.id}>
                                <div>
                                  <div className="settings-title-line">
                                    <h4>{g.goal_race_name || "General fitness goal"}</h4>
                                    <span
                                      className={`settings-state ${raceState === "recovery" ? "is-warning" : raceState === "expired" ? "is-expired" : g.is_active ? "is-connected" : ""}`}
                                      title={raceState === "recovery"
                                        ? "Available to the coach for post-race recovery planning for 30 days."
                                        : raceState === "expired"
                                          ? "This race is no longer included in automatic coaching context."
                                          : undefined}
                                    >
                                      {raceState === "recovery" ? "Recovery" : raceState === "expired" ? "Expired" : g.is_active ? "Active" : "Archived"}
                                    </span>
                                    {g.is_active && raceState === "upcoming" && daysLeft !== null && (
                                      <span className={`settings-state ${daysLeft <= 30 ? "is-warning" : ""}`}>{daysLeft} days</span>
                                    )}
                                  </div>
                                  <div className="settings-goal-meta">
                                    {g.goal_race_date && <span>{g.goal_race_date}</span>}
                                    {g.goal_race_tier && <span>Tier {g.goal_race_tier}</span>}
                                    {g.goal_target_time && <span>Target {g.goal_target_time}</span>}
                                    {g.goal_result_time && <span>Result {g.goal_result_time}</span>}
                                    {g.weekly_training_hours && <span>{g.weekly_training_hours} hr / week</span>}
                                  </div>
                                  {g.goal_description && <p>{g.goal_description}</p>}
                                  {g.goal_race_note && <p>Race note: {g.goal_race_note}</p>}
                                  {documents.filter((document) => document.goal_id === g.id).map((document) => (
                                    <button className="settings-document-link" key={document.id} onClick={() => setPreviewDocument(document)}>
                                      <PaperclipIcon />
                                      {document.original_filename}
                                    </button>
                                  ))}
                                </div>
                                <div className="settings-goal-actions">
                                  <button className="btn btn-ghost btn-sm" onClick={() => startEditGoal(g)}>Edit</button>
                                  {!isFrozen && (
                                    <button className="btn btn-ghost btn-sm" onClick={() => g.id && toggleActive(g.id)}>
                                      {g.is_active ? "Archive" : "Activate"}
                                    </button>
                                  )}
                                  <button className="btn btn-ghost btn-sm settings-danger-action" onClick={() => g.id && deleteGoal(g.id, g.goal_race_name)}>Delete</button>
                                </div>
                              </article>
                            );
                          })
                      )}
                    </div>
                  )}

                </div>

                <div className="settings-subsection" id="settings-documents">
                  <div className="settings-subsection-heading">
                    <div>
                      <h3>Documents</h3>
                      <p>Keep race tickets and order confirmations in this private vault.</p>
                    </div>
                    <FileUpload id="document-upload" value={null} accept="image/*,application/pdf" helper="" buttonLabel="Upload document" iconOnly onChange={(file) => { if (file) void uploadDocument(file); }} />
                  </div>
                  {documentError && <p className="settings-feedback is-error">{documentError}</p>}
                  <div className="settings-doc-grid">
                    {documents.length === 0 ? <p className="settings-empty">No documents yet.</p> : documents.map((document) => (
                      <article className="settings-doc-card" key={document.id} onClick={() => setPreviewDocument(document)}>
                        <div className="settings-doc-card-thumb">
                          {document.content_type.startsWith("image/") ? (
                            <img
                              src={`${apiBase}/api/settings/documents/${document.id}/file`}
                              alt={document.original_filename}
                            />
                          ) : (
                            <iframe
                              src={`${apiBase}/api/settings/documents/${document.id}/file#toolbar=0&view=FitH`}
                              title={document.original_filename}
                              tabIndex={-1}
                            />
                          )}
                        </div>
                        <div className="settings-doc-card-info">
                          <strong className="settings-doc-card-name" title={document.original_filename}>
                            {document.original_filename}
                          </strong>
                          <div className="settings-goal-meta">
                            <span>{document.goal_id ? goals.find((goal) => goal.id === document.goal_id)?.goal_race_name || "Competition" : "All documents"}</span>
                          </div>
                          <div className="settings-doc-card-footer">
                            <span className="settings-doc-card-meta">{formatDocumentSize(document.size_bytes)}</span>
                            <button
                              className="btn btn-ghost btn-sm settings-danger-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteDocument(document.id, document.original_filename);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="settings-subsection" id="settings-training-notes">
                  <div className="settings-subsection-heading">
                    <div>
                      <h3>Training notes</h3>
                      <p>Persistent constraints such as injury history, rest days, and schedule limits. Changes save automatically.</p>
                    </div>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="training-notes-input">Notes used in every coach conversation</label>
                    <textarea
                      id="training-notes-input"
                      rows={5}
                      placeholder={"- Rest every Sunday\n- Avoid steep downhill running\n- Maximum 10 hours per week"}
                      value={profile.training_notes}
                      onChange={(e) => updateProfileField("training_notes", e.target.value)}
                    />
                    <span className="settings-help">Use short, factual notes.</span>
                  </div>
                  {profileError && <p className="settings-feedback is-error">{profileError}</p>}
                </div>
              </section>

          </div>
        </div>
      </main>
      {previewDocument && (
        <div className="doc-preview-overlay" onClick={() => setPreviewDocument(null)}>
          <div className="doc-preview-popup" onClick={(e) => e.stopPropagation()}>
            <div className="doc-preview-header">
              <span className="doc-preview-filename">{previewDocument.original_filename}</span>
              <div className="doc-preview-header-actions">
                <a
                  className="doc-preview-close"
                  aria-label="Download"
                  href={`${apiBase}/api/settings/documents/${previewDocument.id}/file?download=true`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </a>
                <button className="doc-preview-close" aria-label="Close" onClick={() => setPreviewDocument(null)}>✕</button>
              </div>
            </div>
            {previewDocument.content_type.startsWith("image/") ? (
              <img
                className="doc-preview-image"
                src={`${apiBase}/api/settings/documents/${previewDocument.id}/file`}
                alt={previewDocument.original_filename}
              />
            ) : (
              <iframe
                className="doc-preview-frame"
                src={`${apiBase}/api/settings/documents/${previewDocument.id}/file`}
                title={previewDocument.original_filename}
              />
            )}
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="doc-preview-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="doc-preview-popup confirm-delete-popup" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-delete-body">
              <div>
                <p className="confirm-delete-label">{confirmDelete.label}</p>
                <p className="confirm-delete-name">{confirmDelete.name}</p>
              </div>
              <div className="confirm-delete-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-ghost btn-sm settings-danger-action"
                  onClick={async () => {
                    setConfirmDelete(null);
                    await confirmDelete.onConfirm();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
