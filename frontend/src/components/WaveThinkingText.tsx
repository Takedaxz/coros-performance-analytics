import React from "react";
import { ThinkingLogo } from "./ThinkingLogo";

interface WaveThinkingTextProps {
  text?: string;
  showDots?: boolean;
  showLogo?: boolean;
  logoSize?: number;
  animationStyle?: "shimmer" | "wave" | "static";
  className?: string;
  style?: React.CSSProperties;
}

export function WaveThinkingText({
  text = "thinking",
  showDots = false,
  showLogo = true,
  logoSize = 20,
  animationStyle = "shimmer",
  className = "",
  style,
}: WaveThinkingTextProps) {
  const chars = text.split("");
  const charDelayStep = 0.07;
  const dotCount = 3;

  return (
    <span className={`wave-thinking-container ${className}`.trim()} style={style}>
      {showLogo && <ThinkingLogo size={logoSize} />}

      {animationStyle === "shimmer" ? (
        <span className="thinking-text-shimmer">{text}</span>
      ) : animationStyle === "wave" ? (
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
      ) : (
        <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{text}</span>
      )}

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
