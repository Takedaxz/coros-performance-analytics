interface NumberStepperProps {
  ariaLabel: string;
  id?: string;
  value: number | string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | "any";
  compact?: boolean;
}

export default function NumberStepper({
  ariaLabel,
  id,
  value,
  onChange,
  placeholder,
  min = 0,
  max,
  step = 1,
  compact = false,
}: NumberStepperProps) {
  const numericValue = Number(value) || 0;
  const adjust = (direction: -1 | 1) => {
    const increment = step === "any" ? 1 : step;
    const nextValue = Math.min(max ?? Infinity, Math.max(min, numericValue + direction * increment));
    onChange(String(Number(nextValue.toFixed(6))));
  };

  return (
    <div className={`number-stepper${compact ? " number-stepper--compact" : ""}`}>
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        disabled={numericValue <= min}
        onClick={() => adjust(-1)}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6h7" />
        </svg>
      </button>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        disabled={max !== undefined && numericValue >= max}
        onClick={() => adjust(1)}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2.5v7M2.5 6h7" />
        </svg>
      </button>
    </div>
  );
}
