export function removeLegacyEvidenceUsed(content: string): string {
  return content
    .split(/\n\s*\n/)
    .filter((paragraph) => !/^\s*(?:\*\*)?Evidence used:(?:\*\*)?/i.test(paragraph))
    .join("\n\n")
    .trim();
}
