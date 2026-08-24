"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, type DragEvent } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { WaveThinkingText } from "@/components/WaveThinkingText";
import AIModelIcon from "@/components/AIModelIcon";
import { SPORT_ICON_URLS, SportIcon } from "@/components/SportActivityIcon";
import { parseThinkingAndAnswer, removeLegacyEvidenceUsed } from "./answer-display";
import { usePathname, useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOL_LABELS: Record<string, string> = {
  compare_activities: "Workout comparison",
  get_activities: "Activities",
  get_activity_detail: "Workout details",
  get_fitness_history: "Fitness history",
  get_health_trend: "Health & recovery",
  get_past_race_goals: "Past competitions",
  get_scheduled_workout_details: "Workout details",
  get_training_plan: "Training plan",
  propose_create_calendar_workout: "Create calendar workout",
  propose_update_calendar_workout: "Update calendar workout",
  propose_move_calendar_workout: "Move calendar workout",
  propose_delete_calendar_workout: "Delete calendar workout",
  search_coaching_knowledge: "Coaching library",
  search_live_coaching_sources: "Web sources",
  web_search: "Web sources",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/^get_/, "").replaceAll("_", " ");
}

function capitalizeFirstLetter(str: string): string {
  if (!str) return "";
  const trimmed = str.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

type WebSource = {
  title: string;
  url: string;
  snippet?: string;
};

type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  display_arguments?: Record<string, unknown>;
  display_result?: {
    knowledge?: string[];
    sources?: WebSource[];
  };
};

type CalendarChangeAction = {
  action: "create" | "update" | "move" | "delete";
  draft?: Record<string, unknown>;
  uid?: string;
  date?: string;
};

type CalendarChangeResult = {
  text: string;
  success: boolean;
};

type CalendarChangeReview = {
  change: CalendarChangeAction;
  key: string;
};

function calendarChangeAction(tool: ToolCall): CalendarChangeAction | null {
  const actionByTool = {
    propose_create_calendar_workout: "create",
    propose_update_calendar_workout: "update",
    propose_move_calendar_workout: "move",
    propose_delete_calendar_workout: "delete",
  } as const;
  const action = actionByTool[tool.name as keyof typeof actionByTool];
  if (!action) return null;
  const draft = tool.arguments.draft;
  const uid = tool.arguments.uid;
  const date = tool.arguments.date;
  if ((action === "create" || action === "update") && (!draft || typeof draft !== "object" || Array.isArray(draft))) return null;
  if ((action === "update" || action === "move" || action === "delete") && typeof uid !== "string") return null;
  if (action === "move" && typeof date !== "string") return null;
  return {
    action,
    draft: draft && typeof draft === "object" && !Array.isArray(draft) ? draft as Record<string, unknown> : undefined,
    uid: typeof uid === "string" ? uid : undefined,
    date: typeof date === "string" ? date : undefined,
  };
}

function calendarChangeSummary(change: CalendarChangeAction): string {
  if (!change.draft) return `${change.action} COROS workout`;
  const name = typeof change.draft.name === "string" ? change.draft.name : "Workout";
  const date = typeof change.draft.date === "string" ? change.draft.date : "No date";
  const sport = typeof change.draft.sport === "string" ? change.draft.sport : "workout";
  const poolLength = typeof change.draft.pool_length_m === "number" ? ` · ${change.draft.pool_length_m} m pool` : "";
  return `${name} · ${date} · ${sport}${poolLength}`;
}

function calendarChangeSteps(change: CalendarChangeAction): Array<Record<string, unknown>> {
  const steps = change.draft?.steps;
  return Array.isArray(steps) ? steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object" && !Array.isArray(step)) : [];
}

function calendarStepTarget(step: Record<string, unknown>): string | null {
  const value = typeof step.value === "number" ? step.value : null;
  const target = typeof step.target === "string" ? step.target : "";
  if (value === null || !target) return null;
  if (target === "distance") return value >= 1000 ? `${value / 1000} km` : `${value} m`;
  if (target === "time") {
    const seconds = Math.max(0, Math.round(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return `${value} ${target.replaceAll("_", " ")}`;
}

function calendarStepIntensity(step: Record<string, unknown>): string | null {
  const intensity = typeof step.intensity === "string" ? step.intensity : "none";
  const low = typeof step.intensity_low === "number" ? step.intensity_low : null;
  const high = typeof step.intensity_high === "number" ? step.intensity_high : null;
  if (intensity === "none" || low === null) return null;
  const label = intensity === "heart_rate_percent" ? "Threshold HR" : intensity.replaceAll("_", " ");
  const range = high === null || high === low ? String(low) : `${low}\u2013${high}`;
  return `${label} ${range}${intensity.endsWith("percent") ? "%" : intensity === "heart_rate" ? " bpm" : ""}`;
}

function getDomainFromUrl(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stripHtmlTags(str: string): string {
  if (!str) return "";
  return str.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function FaviconImage({ url }: { url: string }) {
  const domain = getDomainFromUrl(url);
  const [hasError, setHasError] = useState(false);
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null;

  if (!faviconUrl || hasError) {
    return (
      <svg className="ai-source-favicon-fallback" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      className="ai-source-favicon"
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="ai-source-external-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function InlineCitationLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) {
    return <a href={href} {...props}>{children}</a>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-citation-link"
      {...props}
    >
      <FaviconImage url={href} />
      <span>{children}</span>
      <ExternalLinkIcon />
    </a>
  );
}

function normalizeToolCall(tool: ToolCall | string): ToolCall {
  return typeof tool === "string" ? { name: tool, arguments: {} } : tool;
}

function formatToolArguments(arguments_: Record<string, unknown>): string {
  return Object.entries(arguments_)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join(", ");
}

function formatToolTooltip(tool: ToolCall): string {
  const calendarChange = calendarChangeAction(tool);
  if (calendarChange) return calendarChangeSummary(calendarChange);
  const knowledge = tool.display_result?.knowledge;
  if (tool.name === "search_coaching_knowledge" && knowledge?.length) {
    return `Query: ${String(tool.arguments.query ?? "")}\n\n${knowledge.join("\n\n")}`;
  }
  return formatToolArguments(tool.display_arguments ?? tool.arguments);
}

function uniqueToolCalls(tools: (ToolCall | string)[]): ToolCall[] {
  const seen = new Set<string>();
  return tools.map(normalizeToolCall).filter((tool) => {
    const key = `${tool.name}:${JSON.stringify(tool.arguments)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SourcesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function GreetingIcon() {
  return (
    <svg
      className="ai-greeting-icon"
      width="32"
      height="32"
      viewBox="0 0 128 128"
      aria-hidden="true"
    >
      <circle
        className="ai-greeting-icon-ring"
        cx="64"
        cy="64"
        r="42"
        fill="none"
        stroke="var(--color-text-secondary)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="74 26"
      />
      <circle
        cx="64"
        cy="64"
        r="23"
        fill="none"
        stroke="var(--color-text-primary)"
        strokeWidth="7"
      />
      <circle cx="64" cy="64" r="8" fill="var(--color-text-primary)" />
    </svg>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function SessionLoadingSkeleton() {
  return (
    <div className="ai-session-skeleton" role="status" aria-label="Loading conversation">
      <div className="ai-session-skeleton-row is-user">
        <span className="skeleton ai-session-skeleton-bubble short" />
      </div>
      <div className="ai-session-skeleton-row">
        <span className="skeleton ai-session-skeleton-bubble long" />
      </div>
      <div className="ai-session-skeleton-row is-user">
        <span className="skeleton ai-session-skeleton-bubble medium" />
      </div>
      <div className="ai-session-skeleton-row">
        <span className="skeleton ai-session-skeleton-bubble longest" />
      </div>
    </div>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2v6h-6" />
      <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function PlusIcon() {
  return <Icons8Icon name="plus" size={14} />;
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5 17 4.5-4.5 3 3L15 13l4 4" />
    </svg>
  );
}

function WebSearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M6.4 11h9.2M11 4.5c2 1.9 3 4.1 3 6.5s-1 4.6-3 6.5M11 4.5C9 6.4 8 8.6 8 11s1 4.6 3 6.5M16 16l4 4" />
    </svg>
  );
}

type SearchMode = "none" | "web" | "deep";

function DeepResearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7A2 2 0 0 1 5 17.5z" />
      <path d="M8 8h6M8 11h5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
      <path d="m18.4 18.4 2.1 2.1" />
    </svg>
  );
}

function CoachingKnowledgeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h11.5v16H7a2.5 2.5 0 0 0-2.5 2.5z" />
      <path d="M4.5 5.5V21M8 7.5h7M8 11h7" />
    </svg>
  );
}

function AttachmentPopover({
  isOpen,
  onClose,
  onAddPhotos,
  searchMode,
  onSelectSearchMode,
  coachingKnowledgeEnabled,
  onToggleCoachingKnowledge,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAddPhotos: () => void;
  searchMode: SearchMode;
  onSelectSearchMode: (mode: SearchMode) => void;
  coachingKnowledgeEnabled: boolean;
  onToggleCoachingKnowledge: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="ai-attachment-popover" ref={popoverRef} role="menu" aria-label="Attachment options">
      <button
        type="button"
        className="ai-attachment-option"
        role="menuitem"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAddPhotos();
          onClose();
        }}
      >
        <span className="ai-attachment-icon"><ImageIcon /></span>
        <div className="ai-attachment-info">
          <div className="ai-attachment-title">Add photos & files</div>
          <div className="ai-attachment-subtitle">Upload from computer</div>
        </div>
      </button>

      <button
        type="button"
        className={`ai-attachment-option${coachingKnowledgeEnabled ? " is-active" : ""}`}
        role="menuitem"
        onClick={() => {
          onToggleCoachingKnowledge();
          onClose();
        }}
      >
        <span className="ai-attachment-icon"><CoachingKnowledgeIcon /></span>
        <div className="ai-attachment-info">
          <div className="ai-attachment-title">
            Coaching knowledge
            {coachingKnowledgeEnabled && <span className="ai-attachment-badge">Active</span>}
          </div>
          <div className="ai-attachment-subtitle">Require guidance from the coach library</div>
        </div>
      </button>

      <button
        type="button"
        className={`ai-attachment-option${searchMode === "web" ? " is-active" : ""}`}
        role="menuitem"
        onClick={() => {
          onSelectSearchMode(searchMode === "web" ? "none" : "web");
          onClose();
        }}
      >
        <span className="ai-attachment-icon">
          <WebSearchIcon />
        </span>
        <div className="ai-attachment-info">
          <div className="ai-attachment-title">
            Web search
            {searchMode === "web" && <span className="ai-attachment-badge">Active</span>}
          </div>
          <div className="ai-attachment-subtitle">Find real-time news and info</div>
        </div>
      </button>

      <button
        type="button"
        className={`ai-attachment-option${searchMode === "deep" ? " is-active" : ""}`}
        role="menuitem"
        onClick={() => {
          onSelectSearchMode(searchMode === "deep" ? "none" : "deep");
          onClose();
        }}
      >
        <span className="ai-attachment-icon">
          <DeepResearchIcon />
        </span>
        <div className="ai-attachment-info">
          <div className="ai-attachment-title">
            Deep research
            {searchMode === "deep" && <span className="ai-attachment-badge is-deep">Active</span>}
          </div>
          <div className="ai-attachment-subtitle">Multi-step iterative scientific research</div>
        </div>
      </button>
    </div>
  );
}

function Icons8Icon({
  name,
  size = 14,
  className,
  color,
  opacity,
}: {
  name: string;
  size?: number;
  className?: string;
  color?: string;
  opacity?: number;
}) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: color || "var(--color-text-secondary)",
        opacity: opacity ?? 0.75,
        WebkitMaskImage: `url(/icons/${name}.png)`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url(/icons/${name}.png)`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}

function ChatIcon({ isActive }: { isActive?: boolean }) {
  return (
    <Icons8Icon
      name="messaging"
      size={13}
      className="ai-session-chat-icon"
      color={isActive ? "var(--color-accent-primary)" : "var(--color-text-secondary)"}
    />
  );
}

function FolderIcon() {
  return <Icons8Icon name="folder" size={13} />;
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CopyMessageButton({ content, label }: { content: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1_500);
  };

  const status = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : `Copy ${label}`;

  return (
    <button
      className={`message-copy-button${copyState === "failed" ? " is-failed" : ""}`}
      type="button"
      aria-label={status}
      title={status}
      onClick={() => void handleCopy()}
    >
      {copyState === "copied" ? <CheckIcon /> : copyState === "failed" ? <XIcon /> : <CopyIcon />}
    </button>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform var(--transition-fast)",
      }}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ThinkingAccordion({ thinking, isThinkingActive }: { thinking: string; isThinkingActive: boolean }) {
  const [isOpen, setIsOpen] = useState(isThinkingActive);

  useEffect(() => {
    if (isThinkingActive) {
      setIsOpen(true);
    }
  }, [isThinkingActive]);

  return (
    <details
      className={`ai-thinking-accordion ${isThinkingActive ? "is-active" : ""}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary>
        <span>{isThinkingActive ? <WaveThinkingText text="Thinking" /> : "Thought process"}</span>
        <ChevronIcon isOpen={isOpen} />
      </summary>
      <div className="ai-thinking-accordion-content">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{thinking}</ReactMarkdown>
      </div>
    </details>
  );
}

type Session = {
  id: string;
  title: string;
  is_pinned: boolean;
  project_id: string | null;
  model_name: string;
  created_at: string;
  updated_at: string;
};

type Project = {
  id: string;
  name: string;
  icon: string | null;
  highlight_color: string | null;
};

const PROJECT_ICON_OPTIONS = Object.entries(SPORT_ICON_URLS)
  .filter(([, url], index, entries) =>
    entries.findIndex(([, candidateUrl]) => candidateUrl === url) === index
  )
  .map(([icon]) => icon);
const PROJECT_COLOR_OPTIONS = [
  { value: "#21E6A5", label: "Mint" },
  { value: "#2D9BF0", label: "Blue" },
  { value: "#F0D348", label: "Yellow" },
  { value: "#FF4D62", label: "Coral" },
  { value: "#9364F0", label: "Violet" },
  { value: "#F08C3C", label: "Orange" },
  { value: "#E06CBA", label: "Pink" },
  { value: "#A5AFB4", label: "Silver" },
];

type ProviderGroup = {
  id: string;
  name: string;
  models: { id: string; name: string }[];
};

type ModelsResponse = {
  models: string[];
  providers?: ProviderGroup[];
  default_model: string;
};

function formatModelShortPillName(id: string, name?: string): string {
  const raw = name || (id.includes(":") ? id.split(":", 2)[1] : id.includes("/") ? id.split("/").pop()! : id);
  if (!raw) return "Model";

  let formatted = raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Specific brand capitalization rules
  formatted = formatted
    .replace(/\bDeepseek\b/gi, "DeepSeek")
    .replace(/\bClaude\b/gi, "Claude")
    .replace(/\bGpt\b/gi, "GPT")
    .replace(/\bOpenai\b/gi, "OpenAI")
    .replace(/\bQwen\b/gi, "Qwen")
    .replace(/\bGemini\b/gi, "Gemini")
    .replace(/\bSonar\b/gi, "Sonar")
    .replace(/\bPerplexity\b/gi, "Perplexity")
    .replace(/\bMistral\b/gi, "Mistral")
    .replace(/\bLlama\b/gi, "Llama")
    .replace(/\bNova\b/gi, "Nova")
    .replace(/\bGrok\b/gi, "Grok")
    .replace(/\bXai\b/gi, "xAI")
    .replace(/\bOllama\b/gi, "Ollama")
    .replace(/\bGroq\b/gi, "Groq");

  return formatted;
}

function getModelSubtitle(id: string, name?: string): string {
  const target = ((name || "") + " " + id).toLowerCase();
  if (target.includes("flash-lite")) return "Fastest answers";
  if (target.includes("flash")) return "All-around help";
  if (target.includes("pro") || target.includes("4o")) return "Advanced math & code";
  if (target.includes("r1") || target.includes("think") || target.includes("reasoning")) return "Complex problem solving";
  return "All-around training help";
}

type ModelItem = {
  id: string;
  name: string;
  description: string;
  badge?: string;
};

function GeminiModelSelector({
  selectedModel,
  onModelChange,
  disabled,
  providers,
  availableModels,
}: {
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled: boolean;
  providers: ProviderGroup[];
  availableModels: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const toggleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceAbove < 360 && spaceBelow > spaceAbove) {
        setDirection("down");
      } else {
        setDirection("up");
      }
    }
    setIsOpen((prev) => !prev);
  };

  const items: ModelItem[] = [];
  if (providers.length > 0) {
    providers.forEach((provider) => {
      provider.models.forEach((m) => {
        const formattedName = formatModelShortPillName(m.id, m.name);
        items.push({
          id: m.id,
          name: formattedName,
          description: getModelSubtitle(m.id, m.name),
        });
      });
    });
  } else {
    availableModels.forEach((model) => {
      const formattedName = formatModelShortPillName(model);
      items.push({
        id: model,
        name: formattedName,
        description: getModelSubtitle(model, formattedName),
      });
    });
  }

  const selectedItem = items.find((item) => item.id === selectedModel);
  const pillLabel = selectedItem ? selectedItem.name : formatModelShortPillName(selectedModel);

  // Build grouped structure for rendering
  const groups: { label: string | null; items: ModelItem[] }[] = [];
  if (providers.length > 0) {
    providers.forEach((provider) => {
      groups.push({
        label: provider.name,
        items: provider.models.map((m) => ({
          id: m.id,
          name: formatModelShortPillName(m.id, m.name),
          description: getModelSubtitle(m.id, m.name),
        })),
      });
    });
  } else {
    groups.push({ label: null, items });
  }

  return (
    <div className="gemini-model-picker-wrap" ref={containerRef}>
      <button
        type="button"
        className={`gemini-model-pill ${isOpen ? "is-open" : ""}`}
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-label="Select AI model"
      >
        <span>{pillLabel}</span>
        <svg
          className={`gemini-chevron ${isOpen ? "is-open" : ""}`}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className={`gemini-model-popover ${direction === "down" ? "direction-down" : "direction-up"}`} role="menu" aria-label="AI Models">
          <div className="gemini-model-popover-scroll">
            {groups.map((group, gi) => (
              <div key={group.label ?? "default"} className="gemini-model-group">
                {group.label && (
                  <div className="gemini-model-group-label">
                    {gi > 0 && <div className="gemini-model-divider" />}
                    <span>{group.label}</span>
                  </div>
                )}
                {group.items.map((item) => {
                  const isSelected = item.id === selectedModel;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`gemini-model-item ${isSelected ? "is-selected" : ""}`}
                      role="menuitem"
                      onClick={() => {
                        onModelChange(item.id);
                        setIsOpen(false);
                      }}
                    >
                      <span className="gemini-model-tier">
                        <AIModelIcon modelId={item.id} modelName={item.name} size={16} />
                      </span>
                      <div className="gemini-model-info">
                        <div className="gemini-model-title-row">
                          <span className="gemini-model-name">{item.name}</span>
                          {item.badge && <span className="gemini-model-badge">{item.badge}</span>}
                        </div>
                        <span className="gemini-model-desc">{item.description}</span>
                      </div>
                      {isSelected && (
                        <span className="gemini-model-check-mark">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  images?: string[];
  tools?: (ToolCall | string)[];
  createdAt?: string;
};

type DBMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  tool_calls?: (ToolCall | string)[];
  created_at: string;
};

type DeleteExchangeResponse = {
  session_deleted: boolean;
  title: string | null;
};

function formatMessageTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

type SuggestedPrompt = {
  label: string;
  detail: string;
  prompt: string;
  action: "briefing" | "ask";
};

const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    label: "Weekly briefing",
    detail: "Summarize the last seven days and what matters next.",
    prompt: "Generate a weekly briefing",
    action: "briefing",
  },
  {
    label: "Check my recovery",
    detail: "Compare HRV, sleep, and recent training.",
    prompt: "How is my recovery today? Review my HRV, sleep, and recent training.",
    action: "ask",
  },
  {
    label: "Plan my next workout",
    detail: "Recommend a session based on current load.",
    prompt: "What should my next workout be based on my recent training and recovery?",
    action: "ask",
  },
  {
    label: "Review training load",
    detail: "Explain whether this week is balanced.",
    prompt: "Review my training load this week and explain whether it is balanced.",
    action: "ask",
  },
  {
    label: "Analyze sleep trends",
    detail: "Find patterns that may be affecting recovery.",
    prompt: "Analyze my recent sleep trends and explain what may be affecting my recovery.",
    action: "ask",
  },
];

const MORE_PROMPTS: SuggestedPrompt[] = [
  {
    label: "Check fitness progress",
    detail: "Review changes in fitness and threshold metrics.",
    prompt: "Review my recent fitness progress and explain the most important changes.",
    action: "ask",
  },
  {
    label: "Review upcoming plan",
    detail: "Check the next seven days in my COROS calendar.",
    prompt: "Review my COROS training plan for the next seven days and suggest what to adjust.",
    action: "ask",
  },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

let cachedSessions: Session[] | null = null;
let cachedProjects: Project[] | null = null;
let cachedExpandedProjects: Set<string> | null = null;

export default function AiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const routeSessionId = pathname.startsWith("/ai/")
    ? decodeURIComponent(pathname.slice(4).split("/", 1)[0])
    : null;
  const [sessionsState, setSessionsState] = useState<Session[]>(() => cachedSessions ?? []);
  const [projectsState, setProjectsState] = useState<Project[]>(() => cachedProjects ?? []);
  const [expandedProjectsState, setExpandedProjectsState] = useState<Set<string>>(() => cachedExpandedProjects ?? new Set());
  const sessions = sessionsState;
  const projects = projectsState;
  const expandedProjects = expandedProjectsState;

  const setSessions = useCallback((action: React.SetStateAction<Session[]>) => {
    setSessionsState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      cachedSessions = next;
      return next;
    });
  }, []);

  const setProjects = useCallback((action: React.SetStateAction<Project[]>) => {
    setProjectsState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      cachedProjects = next;
      return next;
    });
  }, []);

  const setExpandedProjects = useCallback((action: React.SetStateAction<Set<string>>) => {
    setExpandedProjectsState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      cachedExpandedProjects = next;
      return next;
    });
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(routeSessionId !== null);
  const [goals, setGoals] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(() => cachedSessions === null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [sessionPendingDelete, setSessionPendingDelete] = useState<Session | null>(null);
  const [messagePendingAction, setMessagePendingAction] = useState<{
    action: "delete" | "retry";
    messageId: string;
    preview: string;
  } | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [sessionDropTarget, setSessionDropTarget] = useState<string | "chats" | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingProjectIcon, setEditingProjectIcon] = useState<string | null>(null);
  const [editingProjectColor, setEditingProjectColor] = useState<string | null>(null);
  const [projectEditError, setProjectEditError] = useState("");
  const [projectEditSaving, setProjectEditSaving] = useState(false);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectCreateError, setProjectCreateError] = useState("");
  const [projectCreateSaving, setProjectCreateSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);
  const [activeAttachmentMenu, setActiveAttachmentMenu] = useState<"landing" | "chat" | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>("none");
  const [coachingKnowledgeEnabled, setCoachingKnowledgeEnabled] = useState(false);
  const [nickname, setNickname] = useState<string>("");
  const [expandedPillGroup, setExpandedPillGroup] = useState<string | null>(null);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [activeToolTooltip, setActiveToolTooltip] = useState<string | null>(null);
  const [calendarChangeResults, setCalendarChangeResults] = useState<Record<string, CalendarChangeResult>>({});
  const [calendarChangePending, setCalendarChangePending] = useState<string | null>(null);
  const [calendarChangeReview, setCalendarChangeReview] = useState<CalendarChangeReview | null>(null);
  const [calendarChangeToast, setCalendarChangeToast] = useState<string | null>(null);
  const inFlightStreamsRef = useRef<Map<string, Message[]>>(new Map());
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(new Set());
  const routeSessionIdRef = useRef<string | null>(routeSessionId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const projectEditDialogRef = useRef<HTMLDialogElement>(null);
  const calendarChangeDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    routeSessionIdRef.current = routeSessionId;
  }, [routeSessionId]);

  async function confirmCalendarChange(change: CalendarChangeAction, key: string) {
    const path = change.action === "create"
      ? "/api/training-plan/coros/workouts"
      : change.action === "update"
        ? `/api/training-plan/coros/workouts/${encodeURIComponent(change.uid ?? "")}`
        : change.action === "move"
          ? `/api/training-plan/coros/workouts/${encodeURIComponent(change.uid ?? "")}/move`
          : `/api/training-plan/coros/workouts/${encodeURIComponent(change.uid ?? "")}`;
    const method = change.action === "create" ? "POST" : change.action === "update" ? "PUT" : change.action === "move" ? "POST" : "DELETE";
    const body = change.action === "create" || change.action === "update"
      ? { draft: change.draft, confirmed: true }
      : change.action === "move"
        ? { date: change.date, confirmed: true }
        : { confirmed: true };

    setCalendarChangePending(key);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      setCalendarChangeResults((current) => ({
        ...current,
        [key]: { success: true, text: "Updated COROS calendar" },
      }));
      setCalendarChangeToast(
        change.action === "create" ? "Workout added to COROS calendar." : "COROS calendar updated."
      );
      setCalendarChangeReview(null);
    } catch (cause) {
      setCalendarChangeResults((current) => ({
        ...current,
        [key]: {
          success: false,
          text: cause instanceof Error ? cause.message : "Could not update COROS calendar.",
        },
      }));
    } finally {
      setCalendarChangePending(null);
    }
  }

  useEffect(() => {
    if (!calendarChangeToast) return;
    const timeout = window.setTimeout(() => setCalendarChangeToast(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [calendarChangeToast]);

  useEffect(() => {
    if (!activeToolTooltip) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".ai-tool-chip")) {
        setActiveToolTooltip(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveToolTooltip(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeToolTooltip]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActivePreviewImage(null);
    };
    if (activePreviewImage) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePreviewImage]);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/profile`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.nickname) setNickname(data.nickname);
        else if (data?.first_name) setNickname(data.first_name);
      })
      .catch(() => {});
  }, []);

  const processImageFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!fileArray.length) return;

    fileArray.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === "string") {
          setPendingImages((prev) => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processImageFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      processImageFiles(imageFiles);
    }
  };

  const handleRemoveImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const aiResponseRef = useRef("");
  const sessionScrollRef = useRef(false);
  const skipSessionLoadRef = useRef<string | null>(null);
  // Prevents route changes from fetching and overwriting messages while a send is in progress.
  const isStreamingRef = useRef(false);

  useLayoutEffect(() => {
    if (sessionScrollRef.current) {
      const chatHistory = chatHistoryRef.current;
      if (!chatHistory) return;
      chatHistory.scrollTop = chatHistory.scrollHeight;
      sessionScrollRef.current = false;
    } else if (isLoading) {
      const chatHistory = chatHistoryRef.current;
      if (chatHistory) chatHistory.scrollTop = chatHistory.scrollHeight;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    const pending = sessionPendingDelete || projectPendingDelete || messagePendingAction;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [sessionPendingDelete, projectPendingDelete, messagePendingAction]);

  useEffect(() => {
    const dialog = projectEditDialogRef.current;
    if (!dialog) return;
    if (editingProject && !dialog.open) dialog.showModal();
    if (!editingProject && dialog.open) dialog.close();
  }, [editingProject]);

  useEffect(() => {
    const dialog = calendarChangeDialogRef.current;
    if (!dialog) return;
    if (calendarChangeReview && !dialog.open) dialog.showModal();
    if (!calendarChangeReview && dialog.open) dialog.close();
  }, [calendarChangeReview]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions`);
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions((current) => data.map((session) => {
          const local = current.find((item) => item.id === session.id);
          return local && local.title !== "New Chat" && session.title === "New Chat"
            ? { ...session, title: local.title, updated_at: local.updated_at }
            : session;
        }));
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [setSessions]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (!routeSessionId || sessionsState.length === 0) return;
    const routeSession = sessionsState.find((session) => session.id === routeSessionId);
    if (routeSession) {
      setSelectedModel(routeSession.model_name);
      if (routeSession.project_id) {
        const pid = routeSession.project_id;
        setExpandedProjects((prev) => (prev.has(pid) ? prev : new Set(prev).add(pid)));
      }
    }
  }, [routeSessionId, sessionsState]);

  const fetchProjects = useCallback(() => {
    fetch(`${API_BASE}/api/ai/projects`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data: Project[]) => setProjects(data))
      .catch((err) => console.error("Failed to load projects", err));
  }, [setProjects]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai/models`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data: ModelsResponse) => {
        setAvailableModels(data.models);
        setProviders(data.providers ?? []);
        setDefaultModel(data.default_model);
        setSelectedModel((current) => current || data.default_model);
      })
      .catch(() => {
        setAvailableModels([]);
        setProviders([]);
      });
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/goals`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setGoals(data))
      .catch(() => setGoals([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!routeSessionId && inFlightStreamsRef.current.size > 0) {
        setMessagesLoading(false);
        return;
      }
      if (routeSessionId && inFlightStreamsRef.current.has(routeSessionId)) {
        const streamMsgs = inFlightStreamsRef.current.get(routeSessionId)!;
        setMessages(streamMsgs);
        setMessagesLoading(false);
        return;
      }
      if (routeSessionId && (skipSessionLoadRef.current === routeSessionId || streamingSessionIds.has(routeSessionId))) {
        setMessagesLoading(false);
        return;
      }
      setMessages([]);
      setMessagesLoading(routeSessionId !== null);
      if (!routeSessionId) return;
      sessionScrollRef.current = true;

      try {
        const res = await fetch(`${API_BASE}/api/ai/sessions/${routeSessionId}/messages`, {
          signal: controller.signal,
        });
        if (!res.ok) { setMessages([]); return; }
        const dbMsgs: DBMessage[] = await res.json();
        setMessages(dbMsgs.map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "ai" : "user",
          content: m.content,
          images: m.images,
          tools: m.tool_calls,
          createdAt: m.created_at,
        })));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages([]);
        }
      } finally {
        if (!controller.signal.aborted) setMessagesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [routeSessionId, streamingSessionIds]);


  async function createRealSession(projectIdOverride?: string | null): Promise<Session | null> {
    const targetProjectId = projectIdOverride !== undefined ? projectIdOverride : draftProjectId;
    const res = await fetch(`${API_BASE}/api/ai/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_name: selectedModel || defaultModel || null,
        project_id: targetProjectId || null,
      }),
    });
    if (!res.ok) return null;
    const session: Session = await res.json();
    setSessions((prev) => [session, ...prev]);
    setSelectedModel(session.model_name);
    setDraftProjectId(null);
    skipSessionLoadRef.current = session.id;
    routeSessionIdRef.current = session.id;
    return session;
  }

  const handleNewChatInProject = (project: Project) => {
    if (isLoading) return;
    setExpandedProjects((prev) => new Set(prev).add(project.id));
    setDraftProjectId(project.id);
    setMessages([]);
    setInput("");
    setSelectedModel(defaultModel);
    router.push("/ai");
  };

  function handleNewChat() {
    if (isLoading) return;
    setMessages([]);
    setInput("");
    setDraftProjectId(null);
    setSelectedModel(defaultModel);
    router.push("/ai");
  }

  const handleDeleteSession = async (id: string) => {
    setSessionPendingDelete(null);
    try {
      await fetch(`${API_BASE}/api/ai/sessions/${id}`, { method: "DELETE" });
      if (routeSessionId === id) {
        setMessages([]);
        setSelectedModel(defaultModel);
        router.replace("/ai");
      }
      fetchSessions();
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  const handleUpdateSession = async (
    id: string,
    updates: { title?: string; is_pinned?: boolean; model_name?: string; project_name?: string },
  ): Promise<boolean> => {
    const payload = {
      ...updates,
      ...(updates.title ? { title: capitalizeFirstLetter(updates.title) } : {}),
    };
    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        fetchSessions();
        if (updates.project_name !== undefined) fetchProjects();
        return true;
      }
    } catch (err) {
      console.error("Failed to update session", err);
    }
    return false;
  };

  const handleSessionDragStart = (event: DragEvent<HTMLDivElement>, sessionId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sessionId);
    setDraggedSessionId(sessionId);
  };

  const handleSessionDragEnd = () => {
    setDraggedSessionId(null);
    setSessionDropTarget(null);
  };

  const handleSessionDragOver = (
    event: DragEvent<HTMLElement>,
    target: string | "chats",
  ) => {
    if (!draggedSessionId) return;
    const draggedSession = sessions.find((session) => session.id === draggedSessionId);
    const targetProjectId = target === "chats" ? null : target;
    if (!draggedSession || draggedSession.project_id === targetProjectId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSessionDropTarget(target);
  };

  const handleSessionDrop = async (
    event: DragEvent<HTMLElement>,
    target: string | "chats",
  ) => {
    event.preventDefault();
    const sessionId = draggedSessionId || event.dataTransfer.getData("text/plain");
    const targetProject = target === "chats"
      ? null
      : projects.find((project) => project.id === target);
    const session = sessions.find((item) => item.id === sessionId);
    const targetProjectId = targetProject?.id ?? null;

    handleSessionDragEnd();
    if (!session || session.project_id === targetProjectId) return;

    setSessions((current) => current.map((item) => (
      item.id === sessionId ? { ...item, project_id: targetProjectId } : item
    )));
    if (targetProject) {
      setExpandedProjects((current) => new Set(current).add(targetProject.id));
    }

    const moved = await handleUpdateSession(sessionId, {
      project_name: targetProject?.name ?? "",
    });
    if (!moved) fetchSessions();
  };

  const handleCreateProject = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setProjectCreateError("Enter a project name.");
      return;
    }

    setProjectCreateSaving(true);
    setProjectCreateError("");
    try {
      const res = await fetch(`${API_BASE}/api/ai/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || `Unable to create project (HTTP ${res.status}).`);
      }
      setCreatingProject(false);
      setNewProjectName("");
      fetchProjects();
    } catch (err) {
      console.error("Failed to create project", err);
      setProjectCreateError(err instanceof Error ? err.message : "Unable to create project.");
    } finally {
      setProjectCreateSaving(false);
    }
  };

  const handleEditProject = async () => {
    if (!editingProject || !editingProjectName.trim() || projectEditSaving) return;
    setProjectEditSaving(true);
    setProjectEditError("");
    try {
      const res = await fetch(`${API_BASE}/api/ai/projects/${editingProject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingProjectName,
          icon: editingProjectIcon,
          highlight_color: editingProjectColor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || `Unable to update project (HTTP ${res.status}).`);
      }
      const updated: Project = await res.json();
      setProjects((current) => current.map((project) => project.id === updated.id ? updated : project));
      setEditingProject(null);
    } catch (err) {
      setProjectEditError(err instanceof Error ? err.message : "Unable to update project.");
    } finally {
      setProjectEditSaving(false);
    }
  };

  const openProjectEditor = (project: Project) => {
    setEditingProject(project);
    setEditingProjectName(project.name);
    setEditingProjectIcon(project.icon);
    setEditingProjectColor(project.highlight_color);
    setProjectEditError("");
  };

  const handleDeleteProject = async (id: string) => {
    setProjectPendingDelete(null);
    try {
      await fetch(`${API_BASE}/api/ai/projects/${id}`, { method: "DELETE" });
      fetchProjects();
      fetchSessions();
    } catch (err) {
      console.error("Failed to delete project", err);
    }
  };

  async function handleModelChange(modelName: string) {
    const previousModel = selectedModel;
    setSelectedModel(modelName);
    if (!routeSessionId) return;

    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${routeSessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: modelName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Session = await res.json();
      setSessions((current) =>
        current.map((session) => session.id === updated.id ? updated : session)
      );
    } catch {
      setSelectedModel(previousModel);
    }
  }

  async function handleSend(forcedInput?: string, sessionId?: string, overrideHistory?: Message[]) {
    const userMsg = (forcedInput ?? input).trim();
    const currentImages = [...pendingImages];
    const sid = sessionId ?? routeSessionId;
    if ((!userMsg && currentImages.length === 0) || !sid) return;

    if (inFlightStreamsRef.current.has(sid)) return;
    setIsLoading(true);

    const displayQuestion = userMsg || (currentImages.length > 0 ? "[Attached Image]" : "");
    const baseHistory = overrideHistory ?? messages;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sid
          ? { ...s, title: s.title === "New Chat" ? capitalizeFirstLetter(displayQuestion.slice(0, 60)) : capitalizeFirstLetter(s.title), updated_at: new Date().toISOString() }
          : s
      )
    );

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const userMsgObj: Message = {
      id: userMessageId,
      role: "user",
      content: userMsg,
      images: currentImages.length > 0 ? currentImages : undefined,
      createdAt: new Date().toISOString(),
    };
    const initialAiMsg: Message = { id: assistantMessageId, role: "ai", content: "" };
    const initialStreamMsgs = [...baseHistory, userMsgObj, initialAiMsg];

    inFlightStreamsRef.current.set(sid, initialStreamMsgs);
    setStreamingSessionIds((prev) => new Set(prev).add(sid));

    routeSessionIdRef.current = sid;
    setMessages(initialStreamMsgs);
    setInput("");
    setPendingImages([]);

    let streamText = "";

    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${sid}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMsg || "Please analyze the attached image.",
          context_days: 14,
          images: currentImages,
          force_web_search: searchMode === "web" || searchMode === "deep",
          is_deep_research: searchMode === "deep",
          force_coaching_knowledge: coachingKnowledgeEnabled,
          history: baseHistory.slice(-12).map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.content,
          })),
          user_message_id: userMessageId,
          assistant_message_id: assistantMessageId,
        }),
      });

      if (!res.ok) {
        const errorMsgs: Message[] = [...initialStreamMsgs.slice(0, -1), { id: assistantMessageId, role: "ai", content: "Error communicating with AI backend.", createdAt: new Date().toISOString() }];
        inFlightStreamsRef.current.set(sid, errorMsgs);
        if (routeSessionIdRef.current === sid) setMessages(errorMsgs);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const errorMsgs: Message[] = [...initialStreamMsgs.slice(0, -1), { id: assistantMessageId, role: "ai", content: "No readable response body.", createdAt: new Date().toISOString() }];
        inFlightStreamsRef.current.set(sid, errorMsgs);
        if (routeSessionIdRef.current === sid) setMessages(errorMsgs);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const message = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          for (const line of message.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.substring(6));
                if (parsed.text) {
                  streamText += parsed.text;
                  const snapshotText = streamText;
                  const streamMsgs = inFlightStreamsRef.current.get(sid);
                  if (streamMsgs && streamMsgs.length > 0) {
                    const updated = [...streamMsgs];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshotText };
                    inFlightStreamsRef.current.set(sid, updated);
                    if (routeSessionIdRef.current === sid) {
                      setMessages(updated);
                    }
                  }
                }
                if (parsed.tool) {
                  const streamMsgs = inFlightStreamsRef.current.get(sid);
                  if (streamMsgs && streamMsgs.length > 0) {
                    const updated = [...streamMsgs];
                    const last = { ...updated[updated.length - 1] };
                    if (last.role === "ai") {
                      last.tools = [...(last.tools ?? []), parsed.tool];
                      updated[updated.length - 1] = last;
                      inFlightStreamsRef.current.set(sid, updated);
                      if (routeSessionIdRef.current === sid) {
                        setMessages(updated);
                      }
                    }
                  }
                }
              } catch { /* incomplete chunk */ }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

      const streamMsgs = inFlightStreamsRef.current.get(sid);
      if (streamMsgs && streamMsgs.length > 0) {
        const updated = [...streamMsgs];
        const last = updated.at(-1);
        if (last?.role === "ai") updated[updated.length - 1] = { ...last, createdAt: new Date().toISOString() };
        inFlightStreamsRef.current.set(sid, updated);
        if (routeSessionIdRef.current === sid) setMessages(updated);
      }
    } catch {
      const errorMsgs: Message[] = [...initialStreamMsgs.slice(0, -1), { id: assistantMessageId, role: "ai", content: "Failed to connect to AI coach.", createdAt: new Date().toISOString() }];
      inFlightStreamsRef.current.set(sid, errorMsgs);
      if (routeSessionIdRef.current === sid) setMessages(errorMsgs);
    } finally {
      setIsLoading(false);
      inFlightStreamsRef.current.delete(sid);
      setStreamingSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      skipSessionLoadRef.current = null;
      try {
        const res = await fetch(`${API_BASE}/api/ai/sessions/${sid}/messages`);
        if (res.ok) {
          const dbMsgs: DBMessage[] = await res.json();
          if (dbMsgs.length > 0 && routeSessionIdRef.current === sid) {
            setMessages(dbMsgs.map((m) => ({
              id: m.id,
              role: m.role === "assistant" ? "ai" : "user",
              content: m.content,
              images: m.images,
              tools: m.tool_calls,
              createdAt: m.created_at,
            })));
          }
        }
      } catch {
        /* fallback to local messages */
      }
    }
  }

  async function handleMessageAction() {
    const action = messagePendingAction;
    setMessagePendingAction(null);
    if (!action || !routeSessionId) return;

    const messageIndex = messages.findIndex((message) => message.id === action.messageId);
    if (messageIndex < 0) return;

    if (action.action === "delete") {
      const userMessage = messages[messageIndex];
      const userMessageId = userMessage.role === "user"
        ? userMessage.id
        : messages[messageIndex - 1]?.id;
      if (!userMessageId) return;
      const response = await fetch(
        `${API_BASE}/api/ai/sessions/${routeSessionId}/exchanges/${userMessageId}`,
        { method: "DELETE" },
      );
      if (!response.ok) return;
      const result: DeleteExchangeResponse = await response.json();
      if (result.session_deleted) {
        setSessions((current) => current.filter((session) => session.id !== routeSessionId));
        setMessages([]);
        router.replace("/ai");
        return;
      }
      const next = messages.filter((_, index) => index !== messageIndex && index !== messageIndex + 1);
      setMessages(next);
      const title = result.title;
      if (title) {
        setSessions((current) => current.map((session) =>
          session.id === routeSessionId ? { ...session, title } : session
        ));
      }
      return;
    }

    const userMessage = messages[messageIndex - 1];
    if (userMessage?.role !== "user") return;
    const cleanHistory = messages.slice(0, messageIndex - 1);
    const response = await fetch(
      `${API_BASE}/api/ai/sessions/${routeSessionId}/exchanges/${userMessage.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) return;
    setMessages(cleanHistory);
    const retryImages = userMessage.images ?? [];
    setPendingImages(retryImages);
    await handleSend(userMessage.content, routeSessionId, cleanHistory);
  }

  async function generateBriefing(sid: string) {
    if (isLoading) return;
    await handleSend("Generate a weekly briefing", sid);
  }

  async function handleLandingSend(message: string, sessionId: string) {
    const sendPromise = handleSend(message, sessionId);
    window.history.pushState(null, "", `/ai/${encodeURIComponent(sessionId)}`);
    await sendPromise;
  }

  async function handleChipClick(chip: SuggestedPrompt) {
    if (isLoading) return;
    try {
      let sid = routeSessionId;
      if (!sid) {
        const s = await createRealSession();
        if (!s) throw new Error("Unable to create an AI Coach session.");
        sid = s.id;
      }
      if (chip.action === "briefing") {
        if (routeSessionId) await generateBriefing(sid);
        else await handleLandingSend("Generate a weekly briefing", sid);
      } else {
        if (routeSessionId) await handleSend(chip.prompt, sid);
        else await handleLandingSend(chip.prompt, sid);
      }
    } catch (error) {
      console.error("Failed to send AI Coach prompt", error);
    }
  }

  function handleExportMarkdown() {
    if (messages.length === 0) return;
    const session = sessions.find(s => s.id === routeSessionId);
    const title = session ? session.title : "AI Coach Session";

    let mdContent = `# ${title}\n\n`;
    messages.forEach(m => {
      mdContent += `### ${m.role === 'user' ? 'You' : 'AI Coach'}\n${m.content}\n\n`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'chat'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  const isEmpty = messages.length === 0;

  // Shared empty-state content (prompt bar + chips)
  function renderEmptyPrompt(sessionId?: string) {
    const inputId = sessionId ? "new-session-input" : "empty-state-input";
    const racePrompts: SuggestedPrompt[] = goals
      .filter((goal) => goal.goal_race_date && new Date(goal.goal_race_date) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .sort((first, second) => new Date(first.goal_race_date).getTime() - new Date(second.goal_race_date).getTime())
      .slice(0, 3)
      .map((goal) => ({
        label: `Plan for ${goal.goal_race_name}`,
        detail: "Use my COROS calendar to shape the next block.",
        prompt: `Plan a training block for ${goal.goal_race_name}`,
        action: "ask",
      }));
    const balancingPrompt = racePrompts[0] ?? MORE_PROMPTS[0];
    const promptStarters = [...SUGGESTED_PROMPTS, balancingPrompt];
    const morePrompts = [
      ...MORE_PROMPTS.filter((prompt) => prompt !== balancingPrompt),
      ...racePrompts.slice(1),
    ];

    return (
      <div className="ai-link-empty-prompt">
        <div className="ai-landing-pulse-backdrop" aria-hidden="true">
          <div className="ai-pulse-orb ai-pulse-orb-1" />
          <div className="ai-pulse-orb ai-pulse-orb-2" />
          <svg className="ai-pulse-ecg-wave" viewBox="0 0 1200 120" preserveAspectRatio="none">
            <path d="M0,60 L400,60 L410,60 L420,42 L430,78 L440,24 L450,96 L460,48 L470,72 L480,60 L1200,60" />
          </svg>
        </div>

        <div className="ai-link-empty-intro">
          <h1><GreetingIcon />{getGreeting()}{nickname ? `, ${nickname}` : ""}</h1>
        </div>

        <div className="ai-link-empty-composer">
          <label className="sr-only" htmlFor={inputId}>Ask AI Coach</label>

          <div className="cmd-bar-wrap">
            {searchMode !== "none" && (
              <div className={`web-search-active-chip${searchMode === "deep" ? " is-deep-research" : ""}`}>
                {searchMode === "deep" ? <DeepResearchIcon /> : <WebSearchIcon />}
                <span>{searchMode === "deep" ? "Deep research" : "Web search"}</span>
                <button
                  type="button"
                  onClick={() => setSearchMode("none")}
                  title={`Turn off ${searchMode === "deep" ? "deep research" : "web search"}`}
                  aria-label={`Turn off ${searchMode === "deep" ? "deep research" : "web search"}`}
                >
                  <XIcon />
                </button>
              </div>
            )}
            {coachingKnowledgeEnabled && (
              <div className="web-search-active-chip">
                <CoachingKnowledgeIcon />
                <span>Coaching knowledge</span>
                <button type="button" onClick={() => setCoachingKnowledgeEnabled(false)} title="Turn off coaching knowledge" aria-label="Turn off coaching knowledge">
                  <XIcon />
                </button>
              </div>
            )}
            {pendingImages.length > 0 && (
              <div className="staged-images-bar">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="staged-image-item">
                    <img
                      src={img}
                      alt={`Preview ${idx + 1}`}
                      onClick={() => setActivePreviewImage(img)}
                      style={{ cursor: "pointer" }}
                    />
                    <button
                      type="button"
                      className="staged-image-remove"
                      onClick={() => handleRemoveImage(idx)}
                      title="Remove image"
                      aria-label="Remove image"
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cmd-bar-attach-btn"
              onClick={() => setActiveAttachmentMenu((prev) => prev === "landing" ? null : "landing")}
              disabled={isLoading}
              aria-label="Add attachment or action"
              title="Add photos or toggle web search"
            >
              <PlusIcon />
            </button>
            <AttachmentPopover
              isOpen={activeAttachmentMenu === "landing"}
              onClose={() => setActiveAttachmentMenu(null)}
              onAddPhotos={() => fileInputRef.current?.click()}
              searchMode={searchMode}
              onSelectSearchMode={setSearchMode}
              coachingKnowledgeEnabled={coachingKnowledgeEnabled}
              onToggleCoachingKnowledge={() => setCoachingKnowledgeEnabled((enabled) => !enabled)}
            />
            <textarea
              id={inputId}
              className="cmd-bar"
              placeholder="Ask AI Coach"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              onPaste={handlePaste}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!input.trim() && pendingImages.length === 0) return;
                  const msg = input.trim();
                  if (!sessionId) {
                    const s = await createRealSession();
                    if (s) await handleLandingSend(msg, s.id);
                  } else {
                    await handleSend(msg, sessionId);
                  }
                }
              }}
              disabled={isLoading}
              autoFocus
              style={{
                resize: "none",
                lineHeight: "1.4",
                overflowY: "auto"
              }}
              rows={1}
            />
            <div className="cmd-bar-actions">
              <GeminiModelSelector
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                disabled={isLoading || availableModels.length === 0}
                providers={providers}
                availableModels={availableModels}
              />
              <button
                id={sessionId ? "new-session-send-btn" : "empty-state-send-btn"}
                className="cmd-bar-send"
                onClick={async () => {
                  if (!input.trim() && pendingImages.length === 0) return;
                  const msg = input.trim();
                  if (!sessionId) {
                    const s = await createRealSession();
                    if (s) await handleLandingSend(msg, s.id);
                  } else {
                    await handleSend(msg, sessionId);
                  }
                }}
                disabled={isLoading || (!input.trim() && pendingImages.length === 0)}
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>

        {(() => {
          const pillGroups: { key: string; label: string; items: SuggestedPrompt[] }[] = [
            {
              key: "plan",
              label: "Plan",
              items: [
                ...racePrompts,
                { label: "Plan my next workout", detail: "", prompt: "What should my next workout be based on my recent training and recovery?", action: "ask" },
                { label: "Review upcoming plan", detail: "", prompt: "Review my COROS training plan for the next seven days and suggest what to adjust.", action: "ask" },
              ],
            },
            {
              key: "review",
              label: "Review",
              items: [
                { label: "Weekly briefing", detail: "", prompt: "Generate a weekly briefing", action: "briefing" },
                { label: "Review training load", detail: "", prompt: "Review my training load this week and explain whether it is balanced.", action: "ask" },
                { label: "Check fitness progress", detail: "", prompt: "Review my recent fitness progress and explain the most important changes.", action: "ask" },
              ],
            },
            {
              key: "recovery",
              label: "Recovery",
              items: [
                { label: "Check my recovery", detail: "", prompt: "How is my recovery today? Review my HRV, sleep, and recent training.", action: "ask" },
                { label: "Analyze sleep trends", detail: "", prompt: "Analyze my recent sleep trends and explain what may be affecting my recovery.", action: "ask" },
              ],
            },
            {
              key: "analyze",
              label: "Analyze",
              items: [
                { label: "Compare recent runs", detail: "", prompt: "Compare my last 5 runs and highlight key differences in pace, heart rate, and effort.", action: "ask" },
                { label: "Zone distribution", detail: "", prompt: "Show my heart rate zone distribution over the last 2 weeks and explain if the balance is right.", action: "ask" },
              ],
            },
          ];

          return (
            <div className="prompt-pill-groups">
              <ul className="prompt-pills-row" aria-label="Prompt categories">
                {pillGroups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={`prompt-pill${expandedPillGroup === group.key ? " is-active" : ""}`}
                      onClick={() => setExpandedPillGroup(expandedPillGroup === group.key ? null : group.key)}
                      disabled={isLoading}
                    >
                      {group.label}
                    </button>
                  </li>
                ))}
              </ul>

              {expandedPillGroup && (() => {
                const active = pillGroups.find((g) => g.key === expandedPillGroup);
                if (!active || active.items.length === 0) return null;
                return (
                  <ul className="prompt-pills-row prompt-pills-sub" aria-label={`${active.label} options`}>
                    {active.items.map((item) => (
                      <li key={item.label}>
                        <button
                          type="button"
                          className="prompt-pill prompt-pill--sub"
                          onClick={() => handleChipClick(item)}
                          disabled={isLoading}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          );
        })()}
      </div>
    );
  }

  function renderInlineInput(opts: {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
    list?: string;
    placeholder?: string;
    disabled?: boolean;
    inputClassName?: string;
    ariaLabel?: string;
  }) {
    return (
      <span className="ai-inline-input-row">
        <input
          type="text"
          autoFocus
          value={opts.value}
          className={["ai-inline-input-control", opts.inputClassName].filter(Boolean).join(" ")}
          aria-label={opts.ariaLabel}
          disabled={opts.disabled}
          list={opts.list}
          placeholder={opts.placeholder}
          onChange={(e) => opts.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") opts.onSave();
            else if (e.key === "Escape") opts.onCancel();
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={opts.disabled}
          style={{ padding: "2px", color: "var(--color-text-primary)" }}
          onClick={(e) => {
            e.stopPropagation();
            opts.onSave();
          }}
        >
          <CheckIcon />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={opts.disabled}
          style={{ padding: "2px", color: "var(--color-text-primary)" }}
          onClick={(e) => {
            e.stopPropagation();
            opts.onCancel();
          }}
        >
          <XIcon />
        </button>
      </span>
    );
  }

  function renderSessionRow(s: Session) {
    const isActive = s.id === routeSessionId;
    const isHovered = s.id === hoveredSessionId;
    const isEditing = editingSessionId === s.id;
    const isDragging = draggedSessionId === s.id;
    return (
      <div
        key={s.id}
        id={`session-${s.id}`}
        draggable={!isEditing}
        onDragStart={(event) => handleSessionDragStart(event, s.id)}
        onDragEnd={handleSessionDragEnd}
        onClick={() => {
          setSelectedModel(s.model_name);
          router.push(`/ai/${encodeURIComponent(s.id)}`);
        }}
        onMouseEnter={() => setHoveredSessionId(s.id)}
        onMouseLeave={() => setHoveredSessionId(null)}
        style={{
          padding: "var(--space-2)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          background: isActive ? "rgba(33, 230, 165, 0.10)" : isHovered ? "var(--color-surface-secondary)" : "transparent",
          border: isActive ? "1px solid rgba(33, 230, 165, 0.28)" : "1px solid transparent",
          transition: "all var(--transition-fast)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-1)",
          marginBottom: "2px",
        }}
        className={isDragging ? "ai-session-row is-dragging" : "ai-session-row"}
      >
        <ChatIcon isActive={isActive} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            renderInlineInput({
              value: editingTitle,
              onChange: setEditingTitle,
              onSave: () => {
                handleUpdateSession(s.id, { title: editingTitle });
                setEditingSessionId(null);
              },
              onCancel: () => setEditingSessionId(null),
            })
          ) : (
            <>
              <p style={{
                fontSize: "var(--text-xs)",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                margin: 0,
                lineHeight: 1.4,
              }}>
                {capitalizeFirstLetter(s.title)}
              </p>
              <p style={{ alignItems: "center", display: "flex", fontSize: "10px", gap: "6px", color: "var(--color-text-muted)", margin: "2px 0 0", lineHeight: 1 }}>
                {relativeTime(s.updated_at)}
                {streamingSessionIds.has(s.id) && <span className="ai-session-pinned-label" style={{ color: "var(--color-accent-primary)" }}>Thinking...</span>}
                {s.is_pinned && <span className="ai-session-pinned-label">Pinned</span>}
              </p>
            </>
          )}
        </div>
        {!isEditing && (isHovered || isActive) && (
          <details
            className="ai-session-menu"
            name="ai-session-menu"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.removeAttribute("open");
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary className="ai-session-menu-trigger" aria-label={`Actions for ${s.title}`}>
              <span aria-hidden="true">⋮</span>
            </summary>
            <div className="ai-session-menu-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  handleUpdateSession(s.id, { is_pinned: !s.is_pinned });
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                {s.is_pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  setEditingSessionId(s.id);
                  setEditingTitle(s.title);
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={(event) => {
                  setSessionPendingDelete(s);
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                Delete
              </button>
            </div>
          </details>
        )}
      </div>
    );
  }

  function renderProjectGroup(p: Project) {
    const grouped = sessions.filter((s) => s.project_id === p.id);
    const isDropTarget = sessionDropTarget === p.id;
    return (
      <div
        key={p.id}
        className={`ai-session-group${isDropTarget ? " is-drop-target" : ""}`}
        onDragOver={(event) => handleSessionDragOver(event, p.id)}
        onDrop={(event) => void handleSessionDrop(event, p.id)}
      >
        <details
          open={expandedProjects.has(p.id)}
          onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            setExpandedProjects((prev) => {
              const next = new Set(prev);
              if (isOpen) next.add(p.id);
              else next.delete(p.id);
              return next;
            });
          }}
        >
          <summary
            className="ai-session-group-summary"
            style={p.highlight_color ? {
              backgroundColor: `${p.highlight_color}1f`,
              color: p.highlight_color,
            } : undefined}
          >
            {p.icon
              ? <SportIcon sport={p.icon} size={13} color={p.highlight_color ?? undefined} />
              : <FolderIcon />}
            <span className="ai-session-group-name">{p.name}</span>
            <span className="ai-session-group-count">{grouped.length}</span>
          </summary>
          <div className="ai-session-group-body">
            {grouped.length === 0 ? (
              <p className="ai-session-group-empty">No chats yet.</p>
            ) : (
              grouped.map(renderSessionRow)
            )}
          </div>
        </details>
        <details
          className="ai-session-menu ai-session-group-menu"
          name="ai-session-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.removeAttribute("open");
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
            <summary className="ai-session-menu-trigger" aria-label={`Actions for project ${p.name}`}>
              <span aria-hidden="true">⋮</span>
            </summary>
            <div className="ai-session-menu-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  handleNewChatInProject(p);
                }}
              >
                New Chat
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  openProjectEditor(p);
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={(event) => {
                  setProjectPendingDelete(p);
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                Delete
              </button>
            </div>
        </details>
      </div>
    );
  }

  const ungroupedSessions = sessions.filter((s) => !s.project_id);
  const sessionNotFound = !sessionsLoading
    && routeSessionId !== null
    && !sessions.some((session) => session.id === routeSessionId);

  return (
    <div className="ai-link-layout print-block">
      {calendarChangeToast && (
        <div className="plan-calendar-move-toast is-success" role="status" aria-live="polite">
          <span />
          {calendarChangeToast}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleImageFileSelect}
      />
      <Sidebar />
      <main className="ai-link-main print-block">
        <header className="page-header print-hide">
          <PageTitle>AI Coach</PageTitle>
          <div className="ai-link-header-actions">
            {routeSessionId && !sessionNotFound && !isEmpty && (
              <>
                <button className="ai-link-tool-button ai-link-tool-icon-button" onClick={handleExportMarkdown} title="Export as Markdown" aria-label="Export as Markdown">
                  <DownloadIcon />
                </button>
                <button className="ai-link-tool-button ai-link-tool-icon-button" onClick={handlePrint} title="Print / Save as PDF" aria-label="Print or save as PDF">
                  <PrintIcon />
                </button>
              </>
            )}
          </div>
        </header>

        <div className="ai-link-workspace">

          {/* ── Sessions sidebar ── */}
          <aside className="ai-link-sessions print-hide">
            <div className="ai-link-session-header">
              <span>Sessions</span>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  className="ai-link-new-chat"
                  onClick={() => {
                    setNewProjectName("");
                    setProjectCreateError("");
                    setCreatingProject(true);
                  }}
                  title="Add project"
                  aria-label="Add project"
                >
                  <FolderIcon />
                </button>
                <button
                  id="new-chat-btn"
                  className="ai-link-new-chat"
                  onClick={handleNewChat}
                  disabled={isLoading}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>

            <div className="ai-link-session-list">
              {sessionsLoading ? (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center", padding: "var(--space-4)" }}>Loading…</p>
              ) : sessions.length === 0 && projects.length === 0 && !creatingProject ? (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center", padding: "var(--space-4)" }}>No sessions yet.</p>
              ) : (
                <>
                  {(projects.length > 0 || creatingProject) && (
                    <section className="ai-session-section" aria-labelledby="ai-projects-section-title">
                      <h2 id="ai-projects-section-title" className="ai-session-section-heading">Projects</h2>
                      {creatingProject && (
                        <div className="ai-project-create-form">
                          <div className="ai-project-create-row">
                            <FolderIcon />
                            {renderInlineInput({
                              value: newProjectName,
                              onChange: setNewProjectName,
                              onSave: () => handleCreateProject(newProjectName),
                              onCancel: () => {
                                if (projectCreateSaving) return;
                                setCreatingProject(false);
                                setNewProjectName("");
                                setProjectCreateError("");
                              },
                              placeholder: "Project name",
                              disabled: projectCreateSaving,
                              inputClassName: "ai-project-name-input",
                              ariaLabel: "Project name",
                            })}
                          </div>
                          {projectCreateError && (
                            <p className="ai-project-create-error" role="alert">{projectCreateError}</p>
                          )}
                        </div>
                      )}
                      {projects.map(renderProjectGroup)}
                    </section>
                  )}
                  {(ungroupedSessions.length > 0 || projects.length > 0) && (
                    <section
                      className={`ai-session-section${sessionDropTarget === "chats" ? " is-drop-target" : ""}`}
                      aria-labelledby="ai-chats-section-title"
                      onDragOver={(event) => handleSessionDragOver(event, "chats")}
                      onDrop={(event) => void handleSessionDrop(event, "chats")}
                    >
                      <h2 id="ai-chats-section-title" className="ai-session-section-heading">Chats</h2>
                      {ungroupedSessions.map(renderSessionRow)}
                      {ungroupedSessions.length === 0 && draggedSessionId && (
                        <p className="ai-session-drop-hint">Drop chats here</p>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* ── Chat panel ── */}
          <div className="ai-link-chat-panel print-block">
            <div className="ai-link-chat-body">

              {/* No session selected */}
            {sessionNotFound ? (
              <div className="ai-link-empty print-hide">
                <div className="ai-link-empty-intro">
                  <h1>Session not found</h1>
                  <p>This chat may have been deleted or the link may be invalid.</p>
                  <button type="button" className="btn btn-primary" onClick={handleNewChat}>
                    Start a new chat
                  </button>
                </div>
              </div>
            ) : !routeSessionId && messages.length === 0 ? (
              <div className="ai-link-empty print-hide">
                {renderEmptyPrompt()}
              </div>

            ) : messagesLoading ? (
              <div className="ai-link-empty print-hide">
                <SessionLoadingSkeleton />
              </div>
            ) : isEmpty ? (
              /* Session created but no messages yet */
              <div className="ai-link-empty print-hide">
                {renderEmptyPrompt(routeSessionId ?? undefined)}
              </div>

              ) : (
                /* Active conversation */
                <>
                  <div className="print-only-header print-block" style={{ display: "none" }}>
                    <div className="print-header-meta">
                      <span className="print-brand">COROS Performance Analytics • AI Coach</span>
                      <span className="print-date">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                    </div>
                    <h1 className="print-only-title">
                      {sessions.find((s) => s.id === routeSessionId)?.title || "AI Coach Session Report"}
                    </h1>
                  </div>
                  <div ref={chatHistoryRef} id="chat-history" className="ai-link-chat-history print-block">
                    <div className="ai-link-thread print-block">
                      {messages.map((msg, idx) => {
                        if (msg.role === "user") {
                          return (
                            <div key={msg.id} className="msg-row user-row msg-enter" style={{ animationDelay: "0ms" }}>
                              <div className="user-message-content">
                                {msg.images && msg.images.length > 0 && (
                                  <div className="user-attached-images">
                                    {msg.images.map((img, imgIdx) => (
                                      <img
                                        key={imgIdx}
                                        src={img}
                                        alt="Attached image"
                                        className="user-attached-image-thumb"
                                        onClick={() => setActivePreviewImage(img)}
                                      />
                                    ))}
                                  </div>
                                )}
                                {msg.content && <div className="user-pill">{msg.content}</div>}
                                <div className="message-copy-actions">
                                  <CopyMessageButton content={msg.content} label="your message" />
                                  <button
                                    type="button"
                                    className="message-copy-button is-danger"
                                    aria-label="Delete this message and response"
                                    title="Delete exchange"
                                    disabled={streamingSessionIds.has(routeSessionId!)}
                                    onClick={() => setMessagePendingAction({
                                      action: "delete",
                                      messageId: msg.id,
                                      preview: msg.content || "[Attached image]",
                                    })}
                                  >
                                    <TrashIcon />
                                  </button>
                                  {msg.createdAt && <time className="message-timestamp" dateTime={msg.createdAt}>{formatMessageTimestamp(msg.createdAt)}</time>}
                                </div>
                              </div>
                            </div>
                          );
                        }
                        const { thinking, answer, isThinkingActive: hasOpenThinking } = parseThinkingAndAnswer(msg.content);
                        const isCurrentSessionStreaming =
                          (routeSessionId ? streamingSessionIds.has(routeSessionId) : false) ||
                          (isLoading && idx === messages.length - 1);
                        const isAwaitingAnswer = isCurrentSessionStreaming && idx === messages.length - 1 && !answer;
                        const displayAnswer = removeLegacyEvidenceUsed(answer);
                        const tools = msg.tools ? uniqueToolCalls(msg.tools) : [];
                        return (
                          <div key={msg.id} className="msg-row ai-row msg-enter" style={{ animationDelay: "0ms" }}>
                            <div className="ai-text">
                              {thinking && (
                                <ThinkingAccordion thinking={thinking} isThinkingActive={hasOpenThinking || isAwaitingAnswer} />
                              )}
                              {msg.content === "" && isCurrentSessionStreaming ? (
                                <WaveThinkingText text="thinking" />
                              ) : displayAnswer ? (
                                <div className="markdown-body">
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkGfm, remarkMath]} 
                                    rehypePlugins={[rehypeKatex]}
                                    components={{ a: InlineCitationLink }}
                                  >
                                    {displayAnswer.replaceAll(" -- ", " — ")}
                                  </ReactMarkdown>
                                </div>
                              ) : null}
                              {tools.length > 0 && (
                                <div className="ai-tool-calls" aria-label={`Evidence consulted: ${tools.map((tool) => toolLabel(tool.name)).join(", ")}`}>
                                  <span className="ai-tool-calls-icon" aria-hidden="true">
                                    <SourcesIcon />
                                  </span>
                                  {tools.map((tool, toolIndex) => {
                                    const sources = tool.display_result?.sources;
                                    const argumentsText = formatToolTooltip(tool);
                                    const toolKey = `${msg.id}-${tool.name}-${toolIndex}`;
                                    const isPinned = activeToolTooltip === toolKey;
                                    const calendarChange = calendarChangeAction(tool);
                                    const calendarChangeResult = calendarChangeResults[toolKey];
                                    return (
                                      <span className="ai-calendar-change" key={toolKey}>
                                        <span
                                          aria-label={argumentsText ? `${toolLabel(tool.name)}: ${argumentsText}` : toolLabel(tool.name)}
                                          className={`ai-tool-chip${isPinned ? " is-pinned" : ""}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveToolTooltip((prev) => (prev === toolKey ? null : toolKey));
                                          }}
                                        >
                                          {toolLabel(tool.name)}
                                          <span className="ai-tool-tooltip" role="tooltip">
                                            {tool.name === "web_search" && sources && sources.length > 0 ? (
                                              <div className="ai-tool-tooltip-sources">
                                                <div className="ai-tool-tooltip-query">
                                                  query: &quot;{String(tool.arguments.query ?? "")}&quot;
                                                </div>
                                                <div className="ai-tool-tooltip-links">
                                                  {sources.map((s, sIdx) => {
                                                    const cleanTitle = stripHtmlTags(s.title);
                                                    const cleanSnippet = stripHtmlTags(s.snippet ?? "");
                                                    const domain = getDomainFromUrl(s.url);
                                                    return (
                                                      <a
                                                        key={sIdx}
                                                        href={s.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="ai-tool-source-link"
                                                        onClick={(event) => event.stopPropagation()}
                                                      >
                                                        <div className="ai-tool-source-header">
                                                          <FaviconImage url={s.url} />
                                                          <span className="ai-tool-source-domain">{domain || s.url}</span>
                                                          <ExternalLinkIcon />
                                                        </div>
                                                        <span className="ai-tool-source-title">{cleanTitle}</span>
                                                        {cleanSnippet && <span className="ai-tool-source-snippet">{cleanSnippet}</span>}
                                                      </a>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            ) : (
                                              argumentsText
                                            )}
                                          </span>
                                        </span>
                                        {calendarChange && !calendarChangeResult?.success && (
                                          <button
                                            type="button"
                                            className="calendar-change-confirm"
                                            disabled={calendarChangePending === toolKey}
                                            onClick={() => setCalendarChangeReview({ change: calendarChange, key: toolKey })}
                                          >
                                            Review
                                          </button>
                                        )}
                                        {calendarChangeResult && !calendarChangeResult.success && (
                                          <span className={`calendar-change-status${calendarChangeResult.success ? " is-success" : " is-error"}`}>
                                            {calendarChangeResult.text}
                                          </span>
                                        )}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {displayAnswer && (
                                <div className="message-copy-actions">
                                  <CopyMessageButton content={displayAnswer} label="coach response" />
                                  <button
                                    type="button"
                                    className="message-copy-button"
                                    aria-label="Retry this response"
                                    title="Retry response"
                                    disabled={isCurrentSessionStreaming || messages[idx - 1]?.role !== "user"}
                                    onClick={() => setMessagePendingAction({
                                      action: "retry",
                                      messageId: msg.id,
                                      preview: displayAnswer,
                                    })}
                                  >
                                    <RetryIcon />
                                  </button>
                                  {msg.createdAt && <time className="message-timestamp" dateTime={msg.createdAt}>{formatMessageTimestamp(msg.createdAt)}</time>}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {isLoading && messages[messages.length - 1]?.role !== "ai" && (
                        <div className="msg-row ai-row msg-enter">
                          <div className="ai-text">
                            <WaveThinkingText text="thinking" />
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  <div className="chat-input-bar ai-link-composer print-hide">
                    <div className="chat-input-bar-inner">
                      <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
                        {searchMode !== "none" && (
                          <div className={`web-search-active-chip${searchMode === "deep" ? " is-deep-research" : ""}`}>
                            {searchMode === "deep" ? <DeepResearchIcon /> : <WebSearchIcon />}
                            <span>{searchMode === "deep" ? "Deep research" : "Web search"}</span>
                            <button
                              type="button"
                              onClick={() => setSearchMode("none")}
                              title={`Turn off ${searchMode === "deep" ? "deep research" : "web search"}`}
                              aria-label={`Turn off ${searchMode === "deep" ? "deep research" : "web search"}`}
                            >
                              <XIcon />
                            </button>
                          </div>
                        )}
                        {coachingKnowledgeEnabled && (
                          <div className="web-search-active-chip">
                            <CoachingKnowledgeIcon />
                            <span>Coaching knowledge</span>
                            <button type="button" onClick={() => setCoachingKnowledgeEnabled(false)} title="Turn off coaching knowledge" aria-label="Turn off coaching knowledge">
                              <XIcon />
                            </button>
                          </div>
                        )}
                        {pendingImages.length > 0 && (
                          <div className="staged-images-bar">
                            {pendingImages.map((img, idx) => (
                              <div key={idx} className="staged-image-item">
                                <img
                                  src={img}
                                  alt={`Preview ${idx + 1}`}
                                  onClick={() => setActivePreviewImage(img)}
                                  style={{ cursor: "pointer" }}
                                />
                                <button
                                  type="button"
                                  className="staged-image-remove"
                                  onClick={() => handleRemoveImage(idx)}
                                  title="Remove image"
                                  aria-label="Remove image"
                                >
                                  <XIcon />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className="cmd-bar-attach-btn"
                          onClick={() => setActiveAttachmentMenu((prev) => prev === "chat" ? null : "chat")}
                          disabled={isLoading}
                          aria-label="Add attachment or action"
                          title="Add photos or toggle web search"
                        >
                          <PlusIcon />
                        </button>
                        <AttachmentPopover
                          isOpen={activeAttachmentMenu === "chat"}
                          onClose={() => setActiveAttachmentMenu(null)}
                          onAddPhotos={() => fileInputRef.current?.click()}
                          searchMode={searchMode}
                          onSelectSearchMode={setSearchMode}
                          coachingKnowledgeEnabled={coachingKnowledgeEnabled}
                          onToggleCoachingKnowledge={() => setCoachingKnowledgeEnabled((enabled) => !enabled)}
                        />
                        <textarea
                          id="chat-input"
                          className="cmd-bar"
                          placeholder="Ask your coach anything..."
                          value={input}
                          onChange={(e) => {
                            setInput(e.target.value);
                          }}
                          onPaste={handlePaste}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              if (!input.trim() && pendingImages.length === 0) return;
                              handleSend();
                            }
                          }}
                          disabled={isLoading}
                          style={{
                            resize: "none",
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            lineHeight: "1.4",
                            overflowY: "auto"
                          }}
                          rows={1}
                        />
                        <div className="cmd-bar-actions">
                          <GeminiModelSelector
                            selectedModel={selectedModel}
                            onModelChange={handleModelChange}
                            disabled={isLoading || availableModels.length === 0}
                            providers={providers}
                            availableModels={availableModels}
                          />
                          <button
                            id="chat-send-btn"
                            className="cmd-bar-send"
                            onClick={() => {
                              if (!input.trim() && pendingImages.length === 0) return;
                              handleSend();
                            }}
                            disabled={isLoading || (!input.trim() && pendingImages.length === 0)}
                            aria-label="Send message"
                          >
                            <SendIcon />
                          </button>
                        </div>
                      </div>
                      <p className="input-hint">AI can make mistakes. Verify critical training decisions.</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {editingProject && (
          <dialog
            ref={projectEditDialogRef}
            className="ai-project-edit-dialog"
            onCancel={() => setEditingProject(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setEditingProject(null);
            }}
          >
            <form
              className="ai-project-edit-content"
              onSubmit={(event) => {
                event.preventDefault();
                void handleEditProject();
              }}
            >
              <span className="ai-project-edit-label">Project settings</span>
              <h2>Edit project</h2>
              <label className="ai-project-edit-field">
                <span>Project name</span>
                <input
                  autoFocus
                  value={editingProjectName}
                  maxLength={100}
                  onChange={(event) => setEditingProjectName(event.target.value)}
                  disabled={projectEditSaving}
                />
              </label>
              <fieldset className="ai-project-edit-fieldset">
                <legend>Activity icon</legend>
                <div className="ai-project-icon-grid">
                  {PROJECT_ICON_OPTIONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      className={`ai-project-icon-option${editingProjectIcon === icon ? " is-selected" : ""}`}
                      aria-label={`Use ${icon.replaceAll("_", " ")} icon`}
                      title={icon.replaceAll("_", " ")}
                      aria-pressed={editingProjectIcon === icon}
                      onClick={() => setEditingProjectIcon(editingProjectIcon === icon ? null : icon)}
                      disabled={projectEditSaving}
                    >
                      <SportIcon sport={icon} size={24} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="ai-project-edit-fieldset">
                <legend>Highlight color</legend>
                <div className="ai-project-color-grid">
                  {PROJECT_COLOR_OPTIONS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`ai-project-color-option${editingProjectColor === color.value ? " is-selected" : ""}`}
                      aria-label={`Use ${color.label} highlight`}
                      title={`${color.label} highlight`}
                      aria-pressed={editingProjectColor === color.value}
                      onClick={() => setEditingProjectColor(editingProjectColor === color.value ? null : color.value)}
                      disabled={projectEditSaving}
                    >
                      <span style={{ backgroundColor: color.value }} />
                    </button>
                  ))}
                </div>
              </fieldset>
              {projectEditError && <p className="ai-project-edit-error" role="alert">{projectEditError}</p>}
              <div className="ai-delete-dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingProject(null)} disabled={projectEditSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn ai-project-edit-save" disabled={projectEditSaving || !editingProjectName.trim()}>
                  {projectEditSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </dialog>
        )}

        <dialog
          ref={deleteDialogRef}
          className="ai-delete-dialog"
          aria-labelledby="delete-session-title"
          aria-describedby="delete-session-description"
          onCancel={() => { setSessionPendingDelete(null); setProjectPendingDelete(null); setMessagePendingAction(null); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setSessionPendingDelete(null); setProjectPendingDelete(null); setMessagePendingAction(null); }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) { setSessionPendingDelete(null); setProjectPendingDelete(null); setMessagePendingAction(null); }
          }}
        >
          <div className="ai-delete-dialog-content">
            <span className={`ai-delete-dialog-label${messagePendingAction?.action === "retry" ? " is-retry" : ""}`}>
              {messagePendingAction?.action === "retry"
                ? "Retry response"
                : messagePendingAction
                  ? "Delete exchange"
                  : projectPendingDelete
                    ? "Delete project"
                    : "Delete session"}
            </span>
            <h2 id="delete-session-title">
              {messagePendingAction?.action === "retry"
                ? "Replace this response?"
                : messagePendingAction
                  ? "Delete this exchange?"
                  : projectPendingDelete
                    ? "Delete this project?"
                    : "Delete this chat?"}
            </h2>
            <p id="delete-session-description">
              {messagePendingAction?.action === "retry"
                ? "The current response will be permanently removed and generated again from its original message."
                : messagePendingAction
                  ? "This message and its following AI response will be permanently deleted."
                  : projectPendingDelete
                    ? `“${projectPendingDelete.name}” will be removed. Its chats stay and move back out of the project.`
                    : `“${sessionPendingDelete?.title}” and its messages will be permanently deleted.`}
            </p>
            {messagePendingAction && (
              <p className="ai-delete-dialog-preview">{messagePendingAction.preview}</p>
            )}
            <div className="ai-delete-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                autoFocus
                onClick={() => { setSessionPendingDelete(null); setProjectPendingDelete(null); setMessagePendingAction(null); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ai-delete-dialog-confirm${messagePendingAction?.action === "retry" ? " is-retry" : ""}`}
                onClick={() => {
                  if (messagePendingAction) void handleMessageAction();
                  else if (projectPendingDelete) handleDeleteProject(projectPendingDelete.id);
                  else if (sessionPendingDelete) handleDeleteSession(sessionPendingDelete.id);
                }}
              >
                {messagePendingAction?.action === "retry"
                  ? "Retry response"
                  : messagePendingAction
                    ? "Delete exchange"
                    : projectPendingDelete
                      ? "Delete project"
                      : "Delete chat"}
              </button>
            </div>
          </div>
        </dialog>

        <dialog
          ref={calendarChangeDialogRef}
          className="calendar-change-dialog"
          aria-labelledby="calendar-change-title"
          onCancel={() => setCalendarChangeReview(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget && calendarChangePending === null) {
              setCalendarChangeReview(null);
            }
          }}
        >
          {calendarChangeReview && (() => {
            const { change, key } = calendarChangeReview;
            const draft = change.draft;
            const steps = calendarChangeSteps(change);
            const result = calendarChangeResults[key];
            const name = typeof draft?.name === "string" ? draft.name : "Workout";
            const date = typeof draft?.date === "string" ? draft.date : change.date;
            const sport = typeof draft?.sport === "string" ? draft.sport.replaceAll("_", " ") : "";
            const poolLength = typeof draft?.pool_length_m === "number" ? draft.pool_length_m : null;
            const description = typeof draft?.description === "string" ? draft.description : "";
            return (
              <div className="calendar-change-dialog-content">
                <span className="calendar-change-dialog-label">COROS calendar</span>
                <h2 id="calendar-change-title">{change.action[0].toUpperCase() + change.action.slice(1)} workout?</h2>
                <dl className="calendar-change-summary">
                  <div><dt>Workout</dt><dd>{name}</dd></div>
                  {date && <div><dt>Date</dt><dd>{date}</dd></div>}
                  {sport && <div><dt>Sport</dt><dd>{sport}</dd></div>}
                  {poolLength !== null && <div><dt>Pool</dt><dd>{poolLength} m</dd></div>}
                </dl>
                {description && <p className="calendar-change-description">{description}</p>}
                {steps.length > 0 && (
                  <ol className="calendar-change-steps">
                    {steps.map((step, index) => {
                      const stepName = typeof step.name === "string" ? step.name : "Step";
                      const target = calendarStepTarget(step);
                      const repeats = typeof step.repeat_count === "number" ? step.repeat_count : step.repeats;
                      const intensity = calendarStepIntensity(step);
                      return (
                        <li key={`${stepName}-${index}`}>
                          <strong>{stepName}</strong>
                          {target && <span>{target}</span>}
                          {intensity && <span>{intensity}</span>}
                          {typeof repeats === "number" && repeats > 1 && <span>Repeat {repeats}×</span>}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {result && !result.success && <p className="calendar-change-dialog-error" role="alert">{result.text}</p>}
                <div className="ai-delete-dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setCalendarChangeReview(null)} disabled={calendarChangePending === key}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn calendar-change-dialog-confirm"
                    onClick={() => void confirmCalendarChange(change, key)}
                    disabled={calendarChangePending === key}
                  >
                    {calendarChangePending === key ? "Saving…" : "Confirm"}
                  </button>
                </div>
              </div>
            );
          })()}
        </dialog>

        {activePreviewImage && (
          <div
            className="image-preview-modal-overlay"
            onClick={() => setActivePreviewImage(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
          >
            <div
              className="image-preview-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="image-preview-modal-close"
                onClick={() => setActivePreviewImage(null)}
                aria-label="Close preview"
                title="Close preview (Esc)"
              >
                <XIcon />
              </button>
              <img
                src={activePreviewImage}
                alt="Enlarged preview"
                className="image-preview-modal-img"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
