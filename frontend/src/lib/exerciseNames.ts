import exerciseNamesData from "./exerciseNames.json";

const NAME_MAP: Record<string, string> = exerciseNamesData;

const BODY_REGION_NAMES: Record<string, string> = {
  S4208: "Full Body",
  S4209: "Shoulders",
  S4210: "Arms",
  S4211: "Chest",
  S4212: "Back",
  S4213: "Abs",
  S4214: "Legs & Hips",
};

const CODE_RE = /^[TS]\d/;

/**
 * Resolve a COROS strength exercise key or raw name into a clean English display name.
 */
export function resolveExerciseName(nameKey?: string | null, rawName?: string | null): string {
  const key = nameKey?.trim() ?? "";
  const mapped = NAME_MAP[key] ?? BODY_REGION_NAMES[key];
  if (mapped) {
    return mapped;
  }
  const name = rawName?.trim();
  if (name && !CODE_RE.test(name)) {
    return NAME_MAP[name] ?? name;
  }
  return key || name || "Exercise";
}
