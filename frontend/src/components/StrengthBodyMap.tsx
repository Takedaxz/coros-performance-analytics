import { bodyBack, bodyFront, type StrengthBodyPart } from "@/components/strengthBodyParts";

type BodyArea = "shoulders" | "arms" | "chest" | "back" | "abs" | "legs";

type StrengthBodyMapProps = {
  exercises: Array<{ name_key: string; sets: number }>;
};

const AREAS_BY_COROS_KEY: Record<string, Array<BodyArea | "full">> = {
  S4208: ["full"],
  S4209: ["shoulders"],
  S4210: ["arms"],
  S4211: ["chest"],
  S4212: ["back"],
  S4213: ["abs"],
  S4214: ["legs"],
  T1061: ["legs", "abs"],
  T1025: ["arms"],
  T1029: ["arms"],
  T1042: ["chest", "shoulders", "arms"],
  T1052: ["back", "arms"],
  T1053: ["back", "arms"],
  T1070: ["legs"],
  T1226: ["legs"],
  T1243: ["abs"],
  T1287: ["legs", "back"],
  T1335: ["arms"],
  T1337: ["shoulders", "arms"],
  T1393: ["back", "arms", "legs"],
  T1394: ["legs", "shoulders", "arms"],
  T1395: ["back", "arms", "legs"],
  T1396: ["full"],
  T1397: ["legs", "shoulders", "arms"],
};

const AREA_NAMES: Record<BodyArea, string> = {
  shoulders: "Shoulders",
  arms: "Arms",
  chest: "Chest",
  back: "Back",
  abs: "Abs",
  legs: "Legs & Hips",
};

const MUSCLES_BY_AREA: Record<BodyArea, string[]> = {
  shoulders: ["deltoids", "trapezius"],
  arms: ["biceps", "triceps", "forearm"],
  chest: ["chest"],
  back: ["upper-back", "lower-back"],
  abs: ["abs", "obliques"],
  legs: ["quadriceps", "hamstring", "calves", "adductors", "tibialis"],
};

function getIntensityColor(load: number, maximumLoad: number): string {
  if (maximumLoad <= 0 || load <= 0) return "var(--color-overlay-soft)";
  const ratio = load / maximumLoad;
  if (ratio >= 0.85) return `rgba(255, 77, 98, 0.9)`;
  if (ratio >= 0.55) return `rgba(255, 140, 60, 0.85)`;
  return `rgba(255, 196, 60, 0.8)`;
}

function BodyFigure({
  parts,
  side,
  loads,
  maximumLoad,
}: {
  parts: StrengthBodyPart[];
  side: "front" | "back";
  loads: Record<BodyArea, number>;
  maximumLoad: number;
}) {
  const areaForMuscle = (slug: string | undefined): BodyArea | undefined =>
    (Object.keys(MUSCLES_BY_AREA) as BodyArea[]).find((area) =>
      MUSCLES_BY_AREA[area].includes(slug ?? "")
    );

  const fillFor = (slug: string | undefined): string => {
    const area = areaForMuscle(slug);
    if (!area || !loads[area]) return "var(--color-overlay-soft)";
    return getIntensityColor(loads[area], maximumLoad);
  };

  return (
    <div className="strength-body-figure">
      <svg
        viewBox={side === "front" ? "0 0 724 1448" : "724 0 724 1448"}
        role="img"
        aria-label={`${side} body view`}
      >
        {parts.flatMap((part) => [
          ...(part.path?.common ?? []),
          ...(part.path?.left ?? []),
          ...(part.path?.right ?? []),
        ].map((path) => ({ path, slug: part.slug }))).map(({ path, slug }, index) => (
          <path
            key={`${side}-${index}`}
            d={path}
            fill={fillFor(slug)}
            stroke="var(--color-overlay-strong)"
            strokeWidth="2"
          />
        ))}
      </svg>
      <span>{side}</span>
    </div>
  );
}

export default function StrengthBodyMap({ exercises }: StrengthBodyMapProps) {
  const loads: Record<BodyArea, number> = {
    shoulders: 0,
    arms: 0,
    chest: 0,
    back: 0,
    abs: 0,
    legs: 0,
  };
  const areas = Object.keys(loads) as BodyArea[];

  exercises.forEach((exercise) => {
    const exerciseAreas = AREAS_BY_COROS_KEY[exercise.name_key] ?? [];
    if (exerciseAreas.includes("full")) {
      areas.forEach((bodyArea) => { loads[bodyArea] += exercise.sets; });
    } else {
      exerciseAreas
        .filter((area): area is BodyArea => area !== "full")
        .forEach((area) => { loads[area] += exercise.sets; });
    }
  });

  const maximumLoad = Math.max(1, ...Object.values(loads));
  const activeAreas = areas
    .filter((area) => loads[area] > 0)
    .sort((a, b) => loads[b] - loads[a]);

  const intensityColor = (area: BodyArea): string => {
    return getIntensityColor(loads[area], maximumLoad);
  };

  return (
    <section className="strength-body-heatmap" tabIndex={0}>
      <div className="strength-body-heatmap-title">Session focus</div>
      <div className="strength-body-figures">
        <BodyFigure parts={bodyFront} side="front" loads={loads} maximumLoad={maximumLoad} />
        <BodyFigure parts={bodyBack} side="back" loads={loads} maximumLoad={maximumLoad} />
      </div>
      <div className="strength-body-hover-details">
        {activeAreas.length > 0 ? activeAreas.map((area) => (
          <span key={area}>
            <span
              aria-hidden="true"
              className="strength-dot"
              style={{
                background: intensityColor(area),
                boxShadow: `0 0 5px ${intensityColor(area)}`,
              }}
            />
            {AREA_NAMES[area]}
            <em style={{ fontStyle: "normal", opacity: 0.55, fontWeight: 400, fontSize: 10 }}>
              {loads[area]} set{loads[area] !== 1 ? "s" : ""}
            </em>
          </span>
        )) : <span>No body-region data provided.</span>}
      </div>
    </section>
  );
}
