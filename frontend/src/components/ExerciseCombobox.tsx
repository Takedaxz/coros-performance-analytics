"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { resolveExerciseName } from "@/lib/exerciseNames";

export interface ExerciseOption {
  id: string;
  name: string;
  thumbnail_url?: string;
  video_url?: string;
}

interface ExerciseComboboxProps {
  value: string;
  options: ExerciseOption[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (selectedName: string, option?: ExerciseOption) => void;
}

type DropdownPosition = { bottom: number | "auto"; left: number; maxHeight: number; top: number | "auto"; width: number };
type VideoPreview = { left: number; top: number; url: string };

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={open ? "is-open" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function ExerciseCombobox({
  value,
  options,
  loading = false,
  disabled = false,
  onChange,
}: ExerciseComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedValueName = useMemo(() => resolveExerciseName(value, value), [value]);

  const labeledOptions = useMemo(() => {
    return options
      .map((opt) => ({
        ...opt,
        label: resolveExerciseName(opt.name, opt.name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [options]);

  const selectedOption = useMemo(() => {
    return labeledOptions.find((opt) => opt.name === value || opt.label === value || opt.id === value);
  }, [labeledOptions, value]);

  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return labeledOptions;
    return labeledOptions.filter(
      (opt) => opt.label.toLowerCase().includes(term) || opt.name.toLowerCase().includes(term)
    );
  }, [labeledOptions, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node) && !dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDropdown();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (filteredOptions.length > 0 ? (prev + 1) % filteredOptions.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (filteredOptions.length > 0 ? (prev - 1 + filteredOptions.length) % filteredOptions.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) {
        onChange(option.name, option);
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const toggleDropdown = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const viewportPadding = 12;
    const spaceBelow = window.innerHeight - bounds.bottom - viewportPadding;
    const spaceAbove = bounds.top - viewportPadding;
    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(340, Math.max(120, (openUpward ? spaceAbove : spaceBelow) - 4));
    const width = Math.min(Math.max(bounds.width, 320), window.innerWidth - viewportPadding * 2);
    setDropdownPosition({
      bottom: openUpward ? window.innerHeight - bounds.top + 4 : "auto",
      left: Math.max(viewportPadding, Math.min(bounds.left, window.innerWidth - width - viewportPadding)),
      maxHeight,
      top: openUpward ? "auto" : bounds.bottom + 4,
      width,
    });
    setIsOpen(true);
  };

  const clearVideoPreview = () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    setVideoPreview(null);
  };

  const previewVideoAfterDelay = (event: ReactMouseEvent<HTMLButtonElement>, videoUrl?: string) => {
    clearVideoPreview();
    if (!videoUrl) return;
    const optionButton = event.currentTarget;
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      if (!document.body.contains(optionButton)) return;
      const bounds = optionButton.getBoundingClientRect();
      const width = 220;
      const height = 124;
      const padding = 12;
      setVideoPreview({
        left: bounds.right + width + padding <= window.innerWidth ? bounds.right + padding : Math.max(padding, bounds.left - width - padding),
        top: Math.max(padding, Math.min(bounds.top - 40, window.innerHeight - height - padding)),
        url: videoUrl,
      });
    }, 1000);
  };

  return (
    <div className="exercise-combobox-container" ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="exercise-combobox-trigger">
        <button
          type="button"
          className="exercise-combobox-button"
          disabled={disabled || loading}
          onClick={toggleDropdown}
          aria-expanded={isOpen}
          aria-label="Select exercise movement"
        >
          {selectedOption?.thumbnail_url ? (
            <img
              src={selectedOption.thumbnail_url}
              alt=""
              className="exercise-option-thumb-inline"
              loading="lazy"
            />
          ) : null}
          <span className="exercise-selected-label">
            {loading
              ? "Loading movements..."
              : resolvedValueName || "Select movement"}
          </span>
          <span className="exercise-combobox-arrow"><ChevronIcon open={isOpen} /></span>
        </button>
      </div>

      {isOpen && !disabled && !loading && dropdownPosition && createPortal(
        <>
          <div className="exercise-combobox-dropdown" ref={dropdownRef} role="listbox" style={dropdownPosition}>
          <div className="exercise-search-wrap">
            <span className="exercise-search-icon"><SearchIcon /></span>
            <input
              ref={searchInputRef}
              type="text"
              className="exercise-search-input"
              placeholder="Search exercise..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="exercise-search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <ClearIcon />
              </button>
            )}
          </div>
          <ul className="exercise-options-list" ref={listRef}>
            {filteredOptions.length === 0 ? (
              <li className="exercise-option-empty">No exercises found</li>
            ) : (
              filteredOptions.map((option, idx) => {
                const isSelected = option.name === value || option.label === value || option.id === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <li key={option.id} className="exercise-option-item">
                    <button
                      type="button"
                      className={`exercise-option-btn${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}`}
                      onClick={() => {
                        onChange(option.name, option);
                        clearVideoPreview();
                        setIsOpen(false);
                      }}
                      onMouseEnter={(event) => {
                        setHighlightedIndex(idx);
                        previewVideoAfterDelay(event, option.video_url);
                      }}
                      onMouseLeave={clearVideoPreview}
                    >
                      {option.thumbnail_url ? (
                        <img
                          src={option.thumbnail_url}
                          alt={option.label}
                          className="exercise-option-thumb"
                          loading="lazy"
                        />
                      ) : null}
                      <span className="exercise-option-name">{option.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          </div>
          {videoPreview && <aside className="exercise-option-video-preview" style={{ left: videoPreview.left, top: videoPreview.top }} aria-hidden="true"><video src={videoPreview.url} autoPlay loop muted playsInline preload="metadata" /></aside>}
        </>,
        document.body,
      )}
    </div>
  );
}
