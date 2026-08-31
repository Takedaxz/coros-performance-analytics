"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useRef } from "react";
import { nextTheme, type Theme } from "@/lib/theme";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

function SidebarIcon({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 18,
        height: 18,
        backgroundColor: "currentColor",
        opacity: 0.85,
        WebkitMaskImage: `url(/icons/${name}.png)`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url(/icons/${name}.png)`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        flexShrink: 0,
      }}
    />
  );
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/",
        icon: <SidebarIcon name="dashboard" />,
      },
      {
        label: "Trends",
        href: "/trends",
        icon: <SidebarIcon name="trends" />,
      },
    ],
  },
  {
    label: "Training",
    items: [
      {
        label: "Activities",
        href: "/activities",
        icon: <SidebarIcon name="activities" />,
      },
      {
        label: "Training Plan",
        href: "/plan",
        icon: <SidebarIcon name="calendar" />,
      },
      {
        label: "Fitness",
        href: "/fitness",
        icon: <SidebarIcon name="fitness" />,
      },
    ],
  },
  {
    label: "Recovery",
    items: [
      {
        label: "Sleep & HRV",
        href: "/sleep",
        icon: <SidebarIcon name="sleep" />,
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        label: "Ask AI",
        href: "/ai",
        icon: <SidebarIcon name="ai" />,
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: <SidebarIcon name="settings" />,
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
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
    <aside className="sidebar">
      <div className="sidebar-logo">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <circle className="brand-mark-orbit" cx="16" cy="16" r="12" />
          <circle className="brand-mark-ring" cx="16" cy="16" r="6.5" />
          <circle className="brand-mark-core" cx="16" cy="16" r="2.25" />
        </svg>
        <h1>
          <span>COROS</span>
          <span className="brand-word-secondary">Core</span>
        </h1>
      </div>
      <nav aria-label="Primary navigation" className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div className="nav-section" key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${pathname === item.href ? "active" : ""}`}
                aria-label={item.label}
                title={item.label}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          aria-label="Toggle color theme"
          className="theme-toggle"
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
          <span className="theme-toggle-label">Theme</span>
        </button>
      </div>
    </aside>
  );
}
