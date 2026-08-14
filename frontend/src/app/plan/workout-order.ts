export interface OrderedWorkoutStep {
  repeat_group: number | null;
  repeat_count?: number | null;
  repeat_name?: string | null;
}

export function moveStepAcrossRepeatBoundary<T extends OrderedWorkoutStep>(
  steps: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const moving = steps[fromIndex];
  const target = steps[toIndex];
  if (!moving || !target || fromIndex === toIndex || moving.repeat_group === target.repeat_group) return [...steps];

  const withoutMoving = steps.filter((_, index) => index !== fromIndex);
  const targetIndex = toIndex - (fromIndex < toIndex ? 1 : 0);
  const moved = target.repeat_group === null
    ? { ...moving, repeat_group: null, repeat_count: null, repeat_name: null }
    : { ...moving, repeat_group: target.repeat_group, repeat_count: target.repeat_count, repeat_name: target.repeat_name };
  withoutMoving.splice(targetIndex, 0, moved);
  return withoutMoving;
}

export function moveWorkoutBlock<T extends OrderedWorkoutStep>(
  steps: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const seenGroups = new Set<number>();
  const blocks: T[][] = [];
  for (const step of steps) {
    if (step.repeat_group === null) blocks.push([step]);
    else if (!seenGroups.has(step.repeat_group)) {
      seenGroups.add(step.repeat_group);
      blocks.push(steps.filter((candidate) => candidate.repeat_group === step.repeat_group));
    }
  }
  const fromBlock = blocks.findIndex((block) => block.includes(steps[fromIndex]));
  const toBlock = blocks.findIndex((block) => block.includes(steps[toIndex]));
  if (fromBlock < 0 || toBlock < 0 || fromBlock === toBlock) return [...steps];
  const [moving] = blocks.splice(fromBlock, 1);
  blocks.splice(toBlock, 0, moving);
  return blocks.flat();
}

export function moveRepeatStep<T extends OrderedWorkoutStep>(
  steps: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const group = steps[fromIndex]?.repeat_group;
  if (group === null || group === undefined || steps[toIndex]?.repeat_group !== group) return [...steps];
  const positions = steps.flatMap((step, index) => step.repeat_group === group ? [index] : []);
  const fromPosition = positions.indexOf(fromIndex);
  const toPosition = positions.indexOf(toIndex);
  if (fromPosition < 0 || toPosition < 0 || fromPosition === toPosition) return [...steps];
  const children = positions.map((index) => steps[index]);
  const [moving] = children.splice(fromPosition, 1);
  children.splice(toPosition, 0, moving);
  const reordered = [...steps];
  positions.forEach((index, position) => { reordered[index] = children[position]; });
  return reordered;
}
