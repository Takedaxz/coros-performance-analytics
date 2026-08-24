"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
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

  return (
    <div className="exercise-combobox-container" ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="exercise-combobox-trigger">
        <button
          type="button"
          className="exercise-combobox-button"
          disabled={disabled || loading}
          onClick={() => setIsOpen(!isOpen)}
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
          ) : (
            <span className="exercise-thumb-placeholder">🏋️</span>
          )}
          <span className="exercise-selected-label">
            {loading
              ? "Loading movements..."
              : resolvedValueName || "Select movement"}
          </span>
          <span className="exercise-combobox-arrow">{isOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {isOpen && !disabled && !loading && (
        <div className="exercise-combobox-dropdown" role="listbox">
          <div className="exercise-search-wrap">
            <span className="exercise-search-icon">🔍</span>
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
                ✕
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
                        setIsOpen(false);
                      }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                    >
                      {option.thumbnail_url ? (
                        <img
                          src={option.thumbnail_url}
                          alt={option.label}
                          className="exercise-option-thumb"
                          loading="lazy"
                        />
                      ) : (
                        <span className="exercise-option-thumb-fallback">🏋️</span>
                      )}
                      <span className="exercise-option-name">{option.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {selectedOption?.video_url && (
        <div className="exercise-video-preview" aria-label="Exercise demonstration video">
          <video
            src={selectedOption.video_url}
            poster={selectedOption.thumbnail_url}
            controls
            loop
            muted
            playsInline
            preload="metadata"
          />
          <small className="exercise-video-caption">Technique Demo: {selectedOption.label}</small>
        </div>
      )}
    </div>
  );
}
