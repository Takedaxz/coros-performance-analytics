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
        {selectedLabel}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="single-select-menu">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="dropdown-option single-select-option"
            aria-pressed={value === option.value}
            onClick={(event) => {
              onChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            {option.label}
            {value === option.value && (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </details>
  );
}
