"use client";

import { useRef } from "react";
import { nextTheme, type Theme } from "@/lib/theme";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export default function ThemeToggle({ showLabel = true, className = "" }: ThemeToggleProps) {
  const transitionTimeout = useRef<number | null>(null);

  function toggleTheme() {
    const root = document.documentElement;
    const current: Theme = root.dataset.theme === "light" ? "light" : "dark";
    const next = nextTheme(current);

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-transition");
      if (transitionTimeout.current !== null) {
        window.clearTimeout(transitionTimeout.current);
      }
      transitionTimeout.current = window.setTimeout(() => {
        root.classList.remove("theme-transition");
        transitionTimeout.current = null;
      }, 360);
    }

    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      localStorage.setItem("coros-theme", next);
    } catch (error) {
      console.warn("theme_preference_save_failed", { error });
    }
  }

  return (
    <button
      aria-label="Toggle color theme"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      type="button"
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb">
          <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />
          </svg>
        </span>
      </span>
      {showLabel && <span className="theme-toggle-label">Theme</span>}
    </button>
  );
}
