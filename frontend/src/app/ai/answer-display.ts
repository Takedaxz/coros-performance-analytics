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
