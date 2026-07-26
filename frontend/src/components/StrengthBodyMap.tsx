import { bodyBack, bodyFront, type StrengthBodyPart } from "@/components/strengthBodyParts";

type BodyArea = "shoulders" | "arms" | "chest" | "back" | "abs" | "legs";

type StrengthBodyMapProps = {
  exercises: Array<{ name_key: string; sets: number }>;
};

const AREA_BY_COROS_KEY: Record<string, BodyArea | "full"> = {
  S4208: "full",
  S4209: "shoulders",
  S4210: "arms",
  S4211: "chest",
  S4212: "back",
  S4213: "abs",
  S4214: "legs",
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
    if (!area || !loads[area]) return "rgba(255, 255, 255, 0.06)";
    const intensity = loads[area] / maximumLoad;
    return `rgba(255, 77, 98, ${0.22 + intensity * 0.68})`;
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
            stroke="rgba(255, 255, 255, 0.12)"
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
    const area = AREA_BY_COROS_KEY[exercise.name_key];
    if (area === "full") {
      areas.forEach((bodyArea) => { loads[bodyArea] += exercise.sets; });
    } else if (area) {
      loads[area] += exercise.sets;
    }
  });

  const maximumLoad = Math.max(1, ...Object.values(loads));
  const activeAreas = areas.filter((area) => loads[area] > 0);

  return (
    <section className="strength-body-heatmap" tabIndex={0}>
      <div className="strength-body-heatmap-title">Session focus</div>
      <div className="strength-body-figures">
        <BodyFigure parts={bodyFront} side="front" loads={loads} maximumLoad={maximumLoad} />
        <BodyFigure parts={bodyBack} side="back" loads={loads} maximumLoad={maximumLoad} />
      </div>
      <div className="strength-body-hover-details">
        {activeAreas.length > 0 ? activeAreas.map((area) => (
          <span key={area}>{AREA_NAMES[area]} · {loads[area]} sets</span>
        )) : <span>COROS did not provide body-region segments.</span>}
      </div>
    </section>
  );
}
