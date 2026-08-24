export function removeLegacyEvidenceUsed(content: string): string {
  let cleaned = content
    .split(/\n\s*\n/)
    .filter((paragraph) => !/^\s*(?:\*\*)?Evidence used:(?:\*\*)?/i.test(paragraph))
    .join("\n\n")
    .trim();

  // Strip (Source: [link]) or Source: [link] wrapping text
  cleaned = cleaned.replace(/\(\s*Source:\s*(\[[^\]]+\]\([^)]+\))\s*\)/gi, "$1");
  cleaned = cleaned.replace(/Source:\s*(\[[^\]]+\]\([^)]+\))/gi, "$1");

  return cleaned;
}

export function parseThinkingAndAnswer(
  rawContent: string,
): { thinking: string | null; answer: string; isThinkingActive: boolean } {
  const toolThoughtMarker = "<tool-thought>";
  const toolThoughtParts = rawContent.split(toolThoughtMarker);
  if (toolThoughtParts.length > 1) {
    const preToolThinking = toolThoughtParts
      .slice(0, -1)
      .join("\n\n")
      .replaceAll("<think>", "")
      .replaceAll("</think>", "")
      .trim();
    const parsed = parseThinkingAndAnswer(toolThoughtParts.at(-1) ?? "");
    const answer = parsed.answer.trim();
    return {
      thinking: [preToolThinking, parsed.thinking].filter(Boolean).join("\n\n") || null,
      answer,
      isThinkingActive: parsed.isThinkingActive || !answer,
    };
  }

  if (!rawContent.includes("<think>")) {
    return { thinking: null, answer: rawContent, isThinkingActive: false };
  }

  const thinkStartIndex = rawContent.indexOf("<think>");
  const thinkEndIndex = rawContent.indexOf("</think>");

  if (thinkEndIndex !== -1) {
    const thinking = rawContent.slice(thinkStartIndex + 7, thinkEndIndex).trim();
    const beforeThinking = rawContent.slice(0, thinkStartIndex).trim();
    const afterThinking = rawContent.slice(thinkEndIndex + 8).trim();
    return {
      thinking: thinking || null,
      answer: [beforeThinking, afterThinking].filter(Boolean).join("\n\n"),
      isThinkingActive: false,
    };
  }

  const thinking = rawContent.slice(thinkStartIndex + 7).trim();
  const answer = rawContent.slice(0, thinkStartIndex).trim();
  return { thinking: thinking || null, answer, isThinkingActive: true };
}
