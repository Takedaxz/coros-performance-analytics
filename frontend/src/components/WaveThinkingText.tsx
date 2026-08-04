import React from "react";

interface WaveThinkingTextProps {
  text?: string;
  showDots?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function WaveThinkingText({
  text = "thinking",
  showDots = true,
  className = "",
  style,
}: WaveThinkingTextProps) {
  const chars = text.split("");
  const charDelayStep = 0.07;
  const dotCount = 3;

  return (
    <span className={`wave-thinking-container ${className}`.trim()} style={style}>
      <span className="wave-text-words" style={{ display: "inline-flex" }}>
        {chars.map((char, index) => {
          const delay = (index * charDelayStep).toFixed(2);
          return (
            <span
              key={index}
              className="wave-char"
              style={{
                animationDelay: `${delay}s`,
                whiteSpace: "pre",
              }}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          );
        })}
      </span>

      {showDots && (
        <span className="wave-dots" style={{ display: "inline-flex", gap: "4px", marginLeft: "4px", alignItems: "center" }}>
          {Array.from({ length: dotCount }).map((_, i) => {
            const delay = ((chars.length + i) * charDelayStep).toFixed(2);
            return (
              <span
                key={i}
                className="wave-dot"
                style={{
                  animationDelay: `${delay}s`,
                }}
              />
            );
          })}
        </span>
      )}
    </span>
  );
}
