export const MAX_SELECTED_RESPONSE_EXCERPT_LENGTH = 4_000;
const SELECTED_RESPONSE_PREFIX = "Selected response (primary reference):";
const USER_INSTRUCTION_PREFIX = "User instruction:";

export function parseSelectedResponseQuestion(
  content: string,
): { excerpt: string; instruction: string } | null {
  if (!content.startsWith(SELECTED_RESPONSE_PREFIX)) return null;
  const sections = content.slice(SELECTED_RESPONSE_PREFIX.length).split(`\n\n${USER_INSTRUCTION_PREFIX}\n\n`);
  if (sections.length !== 2) return null;
  const excerpt = sections[0].trim();
  const instruction = sections[1].trim();
  return excerpt && instruction ? { excerpt, instruction } : null;
}

export function formatSelectedResponseQuestion(instruction: string, excerpt: string | null): string {
  const selectedResponse = excerpt?.trim().slice(0, MAX_SELECTED_RESPONSE_EXCERPT_LENGTH);
  if (!selectedResponse) return instruction.trim();

  return [
    SELECTED_RESPONSE_PREFIX,
    selectedResponse,
    USER_INSTRUCTION_PREFIX,
    instruction.trim() || "Respond directly to the selected response.",
  ].join("\n\n");
}

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
