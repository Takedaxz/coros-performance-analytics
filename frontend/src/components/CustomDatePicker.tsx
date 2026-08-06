"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";

export type DatePickerMode = "date" | "week" | "month" | "year";

interface CustomDatePickerProps {
  id?: string;
  value: string; // YYYY-MM-DD, YYYY-MM, YYYY-Www, or YYYY
  onChange: (value: string) => void;
  mode?: DatePickerMode;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(str: string): Date | null {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [y, m] = str.split("-").map(Number);
    const date = new Date(y, m - 1, 1);
    return isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{4}$/.test(str)) {
    const y = Number(str);
    const date = new Date(y, 0, 1);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getISOWeekInfo(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week: weekNo, year: d.getUTCFullYear() };
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function CustomDatePicker({
  id,
  value,
  onChange,
  mode = "date",
  placeholder = "Select date",
  ariaLabel,
  disabled = false,
  minDate,
  maxDate,
}: CustomDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = useMemo(() => parseDateKey(value), [value]);

  const [viewDate, setViewDate] = useState<Date>(() => selectedDate || new Date());
  const [viewMode, setViewMode] = useState<"days" | "months" | "years">(() => {
    if (mode === "year") return "years";
    if (mode === "month") return "months";
    return "days";
  });

  const [hoveredWeekKey, setHoveredWeekKey] = useState<string | null>(null);
  const [isDropUp, setIsDropUp] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Sync view date when selectedDate changes externally
  useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate);
    }
  }, [selectedDate]);

  // Sync viewMode when mode prop changes
  useEffect(() => {
    if (mode === "year") setViewMode("years");
    else if (mode === "month") setViewMode("months");
    else setViewMode("days");
  }, [mode]);

  // Click outside to close popover
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  }, []);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setIsDropUp(spaceBelow < 340);
      if (mode === "year") setViewMode("years");
      else if (mode === "month") setViewMode("months");
      else setViewMode("days");
    }
    setIsOpen((prev) => !prev);
  };

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateKey(today), [today]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Decade block centered on current year
  const yearBlockStart = useMemo(() => Math.floor(year / 12) * 12, [year]);
  const yearBlock = useMemo(
    () => Array.from({ length: 12 }, (_, i) => yearBlockStart + i),
    [yearBlockStart]
  );

  // Generate 42 calendar grid cells (6 weeks)
  const days = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay(); // 0: Sun ... 6: Sat
    const firstCell = new Date(year, month, 1 - startDay);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(firstCell);
      d.setDate(firstCell.getDate() + i);
      return d;
    });
  }, [year, month]);

  const formattedDisplayValue = useMemo(() => {
    if (!value) return "";
    if (mode === "year") return value;
    if (mode === "month") {
      const [y, m] = value.split("-").map(Number);
      if (y && m && MONTHS[m - 1]) {
        return `${MONTHS[m - 1].slice(0, 3)} ${y}`;
      }
      return value;
    }
    if (mode === "week") {
      if (value.includes("-W")) {
        const [yStr, wStr] = value.split("-W");
        return `Week ${wStr}, ${yStr}`;
      }
      const d = parseDateKey(value);
      if (d) {
        const { week, year: wYear } = getISOWeekInfo(d);
        return `Week ${week}, ${wYear}`;
      }
      return value;
    }
    // Date mode
    const parseD = parseDateKey(value);
    if (!parseD) return value;
    return parseD.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [value, mode]);

  const handlePrevNav = () => {
    if (viewMode === "years") {
      setViewDate(new Date(year - 12, month, 1));
    } else {
      setViewDate(new Date(year, month - 1, 1));
    }
  };

  const handleNextNav = () => {
    if (viewMode === "years") {
      setViewDate(new Date(year + 12, month, 1));
    } else {
      setViewDate(new Date(year, month + 1, 1));
    }
  };

  const handleSelectDay = (date: Date) => {
    const key = formatDateKey(date);
    if (minDate && key < minDate) return;
    if (maxDate && key > maxDate) return;

    if (mode === "week") {
      const { week, year: wYear } = getISOWeekInfo(date);
      const weekVal = `${wYear}-W${String(week).padStart(2, "0")}`;
      onChange(weekVal);
    } else {
      onChange(key);
    }
    setIsOpen(false);
  };

  const handleSelectMonth = (mIdx: number) => {
    const monthStr = `${year}-${String(mIdx + 1).padStart(2, "0")}`;
    if (mode === "month") {
      onChange(monthStr);
      setIsOpen(false);
    } else {
      setViewDate(new Date(year, mIdx, 1));
      setViewMode("days");
    }
  };

  const handleSelectYear = (yNum: number) => {
    if (mode === "year") {
      onChange(String(yNum));
      setIsOpen(false);
    } else {
      setViewDate(new Date(yNum, month, 1));
      setViewMode(mode === "month" ? "months" : "months");
    }
  };

  const handleClear = () => {
    onChange("");
    setIsOpen(false);
  };

  const handleToday = () => {
    const key = formatDateKey(today);
    if (minDate && key < minDate) return;
    if (maxDate && key > maxDate) return;
    if (mode === "year") {
      onChange(String(today.getFullYear()));
    } else if (mode === "month") {
      onChange(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
    } else if (mode === "week") {
      const { week, year: wYear } = getISOWeekInfo(today);
      onChange(`${wYear}-W${String(week).padStart(2, "0")}`);
    } else {
      onChange(key);
    }
    setViewDate(today);
    setIsOpen(false);
  };

  const selectedWeekInfo = useMemo(() => {
    if (mode !== "week" || !value) return null;
    if (value.includes("-W")) {
      const [yStr, wStr] = value.split("-W").map(Number);
      return { year: yStr, week: wStr };
    }
    const d = parseDateKey(value);
    return d ? getISOWeekInfo(d) : null;
  }, [mode, value]);

  return (
    <div
      ref={containerRef}
      className={`custom-datepicker-container ${isOpen ? "is-open" : ""} ${isDropUp ? "is-dropup" : ""}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`custom-datepicker-trigger ${isOpen ? "is-open" : ""}`}
        onClick={handleToggle}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={formattedDisplayValue ? "custom-datepicker-value" : "custom-datepicker-placeholder"}>
          {formattedDisplayValue || placeholder}
        </span>
        <span className="custom-datepicker-icon" aria-hidden="true">
          <CalendarIcon />
        </span>
      </button>

      {isOpen && (
        <div className={`custom-datepicker-popover ${isDropUp ? "drop-up" : ""}`} role="dialog" aria-modal="true">
          {/* Header Controls */}
          <div className="custom-datepicker-header">
            <div className="custom-datepicker-title-group">
              <button
                type="button"
                className={`custom-datepicker-header-btn ${viewMode === "months" ? "is-active" : ""}`}
                onClick={() => setViewMode(viewMode === "months" ? "days" : "months")}
              >
                <span>{MONTHS[month]}</span>
                <span className="custom-datepicker-caret">▾</span>
              </button>
              <button
                type="button"
                className={`custom-datepicker-header-btn ${viewMode === "years" ? "is-active" : ""}`}
                onClick={() => setViewMode(viewMode === "years" ? "days" : "years")}
              >
                <span>{year}</span>
                <span className="custom-datepicker-caret">▾</span>
              </button>
            </div>
            <div className="custom-datepicker-nav">
              <button
                type="button"
                className="custom-datepicker-nav-btn"
                onClick={handlePrevNav}
                aria-label={viewMode === "years" ? "Previous 12 years" : "Previous month"}
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className="custom-datepicker-nav-btn"
                onClick={handleNextNav}
                aria-label={viewMode === "years" ? "Next 12 years" : "Next month"}
              >
                <ChevronDownIcon />
              </button>
            </div>
          </div>

          {/* Year Selector Mode */}
          {viewMode === "years" && (
            <div className="custom-datepicker-years-grid">
              {yearBlock.map((yNum) => {
                const isSelectedYear = mode === "year" && value === String(yNum);
                return (
                  <button
                    key={yNum}
                    type="button"
                    className={`custom-datepicker-year-cell ${yNum === year || isSelectedYear ? "is-selected" : ""}`}
                    onClick={() => handleSelectYear(yNum)}
                  >
                    {yNum}
                  </button>
                );
              })}
            </div>
          )}

          {/* Month Selector Mode */}
          {viewMode === "months" && (
            <div className="custom-datepicker-months-grid">
              {MONTHS.map((mName, mIdx) => {
                const monthStr = `${year}-${String(mIdx + 1).padStart(2, "0")}`;
                const isSelectedMonth = mode === "month" && value === monthStr;
                return (
                  <button
                    key={mName}
                    type="button"
                    className={`custom-datepicker-month-cell ${mIdx === month || isSelectedMonth ? "is-selected" : ""}`}
                    onClick={() => handleSelectMonth(mIdx)}
                  >
                    {mName.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Days / Week Grid Mode */}
          {viewMode === "days" && (
            <>
              <div className="custom-datepicker-weekdays">
                {WEEKDAYS.map((wd, i) => (
                  <span key={i}>{wd}</span>
                ))}
              </div>

              <div className="custom-datepicker-days-grid">
                {days.map((d) => {
                  const dKey = formatDateKey(d);
                  const inMonth = d.getMonth() === month;
                  const dWeek = getISOWeekInfo(d);
                  const isSelectedDay = mode === "date" && value === dKey;
                  const isSelectedWeek =
                    mode === "week" &&
                    selectedWeekInfo != null &&
                    selectedWeekInfo.week === dWeek.week &&
                    selectedWeekInfo.year === dWeek.year;

                  const isHoveredWeek =
                    mode === "week" &&
                    hoveredWeekKey != null &&
                    hoveredWeekKey === `${dWeek.year}-W${dWeek.week}`;

                  const isToday = todayKey === dKey;
                  const isDisabled = Boolean((minDate && dKey < minDate) || (maxDate && dKey > maxDate));

                  return (
                    <button
                      key={dKey}
                      type="button"
                      disabled={isDisabled}
                      className={`custom-datepicker-day-cell ${inMonth ? "" : "is-outside"} ${isSelectedDay ? "is-selected" : ""} ${isSelectedWeek ? "is-in-week" : ""} ${isHoveredWeek ? "is-hovered-week" : ""} ${isToday ? "is-today" : ""}`}
                      onClick={() => handleSelectDay(d)}
                      onMouseEnter={() => mode === "week" && setHoveredWeekKey(`${dWeek.year}-W${dWeek.week}`)}
                      onMouseLeave={() => mode === "week" && setHoveredWeekKey(null)}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Action Footer */}
          <div className="custom-datepicker-footer">
            <button type="button" className="custom-datepicker-action-btn clear" onClick={handleClear}>
              Clear
            </button>
            <button type="button" className="custom-datepicker-action-btn today" onClick={handleToday}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
