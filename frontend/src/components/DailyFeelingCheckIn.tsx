"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type FeelingLevel = "very_low" | "low" | "okay" | "good" | "great";

export interface DailyFeeling {
  date: string;
  feeling: FeelingLevel;
  note: string | null;
}

export const FEELING_OPTIONS: { value: FeelingLevel; label: string; icon: string }[] = [
  { value: "very_low", label: "Very low", icon: "https://img.icons8.com/liquid-glass/100/crazy.png" },
  { value: "low", label: "Low", icon: "https://img.icons8.com/liquid-glass/100/sad.png" },
  { value: "okay", label: "Okay", icon: "https://img.icons8.com/liquid-glass/100/neutral-emoticon.png" },
  { value: "good", label: "Good", icon: "https://img.icons8.com/liquid-glass/100/happy.png" },
  { value: "great", label: "Great", icon: "https://img.icons8.com/liquid-glass/100/smiling-face-with-heart.png" },
];

function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function DailyFeelingCheckIn() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<FeelingLevel | null>(null);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [needsCheckIn, setNeedsCheckIn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadToday() {
      try {
        const response = await fetch(`${API_BASE}/api/feelings/today`);
        if (!response.ok) throw new Error("Could not load today's feeling.");
        const entry: DailyFeeling | null = await response.json();
        if (entry) dialogRef.current?.close();
        else setNeedsCheckIn(true);
      } catch {
        setError("Your check-in could not load. Retry to continue.");
        setNeedsCheckIn(true);
      } finally {
        setIsLoading(false);
      }
    }
    void loadToday();
  }, []);

  useEffect(() => {
    if (needsCheckIn) dialogRef.current?.showModal();
  }, [needsCheckIn]);

  async function saveFeeling() {
    if (!selected) {
      setError("Choose how you feel today.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/feelings/${localToday()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeling: selected, note }),
      });
      if (!response.ok) throw new Error("Could not save today's feeling.");
      dialogRef.current?.close();
    } catch {
      setError("Your check-in could not be saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog
      aria-labelledby="daily-feeling-title"
      className="daily-feeling-dialog"
      onCancel={(event) => event.preventDefault()}
      ref={dialogRef}
    >
      <div className="daily-feeling-dialog-content">
        <span className="daily-feeling-kicker">Daily check-in</span>
        <h2 id="daily-feeling-title">How do you feel today?</h2>
        <p>Your answer helps AI Coach adapt to you, not only your watch data.</p>
        <div aria-label="Today’s feeling" className="daily-feeling-options" role="radiogroup">
          {FEELING_OPTIONS.map((option) => (
            <button
              aria-checked={selected === option.value}
              aria-label={option.label}
              className={`daily-feeling-choice daily-feeling-choice--${option.value}`}
              key={option.value}
              onClick={() => setSelected(option.value)}
              role="radio"
              title={option.label}
              type="button"
            >
              <img alt={option.label} aria-hidden="true" className="daily-feeling-choice-icon" src={option.icon} />
            </button>
          ))}
        </div>
        <label className="daily-feeling-note">
          <span>Anything affecting today? <em>Optional</em></span>
          <textarea
            maxLength={280}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Travel, soreness, stress, illness…"
            value={note}
          />
        </label>
        {error && <p className="daily-feeling-error" role="alert">{error}</p>}
        <button className="btn btn-primary daily-feeling-save" disabled={isLoading || isSaving} onClick={saveFeeling} type="button">
          {isSaving ? "Saving…" : "Save today’s feeling"}
        </button>
      </div>
    </dialog>
  );
}
