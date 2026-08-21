"use client";

interface SingleSelectOption {
  value: string;
  label: string;
}

interface SingleSelectProps {
  ariaLabel: string;
  detailsName?: string;
  id?: string;
  onChange: (value: string) => void;
  options: readonly SingleSelectOption[];
  value: string;
}

export default function SingleSelect({
  ariaLabel,
  detailsName,
  id,
  onChange,
  options,
  value,
}: SingleSelectProps) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <details className="single-select" id={id} name={detailsName}>
      <summary className="single-select-trigger" aria-label={ariaLabel}>
        <span className="single-select-trigger-label">{selectedLabel}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="single-select-menu" role="listbox">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            className="single-select-option"
            aria-selected={value === option.value}
            onClick={(event) => {
              onChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span className="single-select-option-label">{option.label}</span>
            <span className="single-select-option-check" aria-hidden="true">
              {value === option.value && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 7.2 5.3 10 11.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
