import assert from "node:assert/strict";
import test from "node:test";
import { moveRepeatStep, moveStepAcrossRepeatBoundary, moveWorkoutBlock } from "./workout-order.ts";

const steps = [
  { name: "Warm Up", repeat_group: null },
  { name: "Run", repeat_group: 1 },
  { name: "Rest", repeat_group: 1 },
  { name: "Cool Down", repeat_group: null },
];

test("moves a repeat group as one top-level block", () => {
  assert.deepEqual(moveWorkoutBlock(steps, 1, 3).map((step) => step.name), ["Warm Up", "Cool Down", "Run", "Rest"]);
});

test("reorders a child only inside its repeat group", () => {
  assert.deepEqual(moveRepeatStep(steps, 2, 1).map((step) => step.name), ["Warm Up", "Rest", "Run", "Cool Down"]);
});

test("moves a step into and out of a repeat block", () => {
  const inside = moveStepAcrossRepeatBoundary(steps, 0, 1);
  assert.deepEqual(inside.map((step) => step.name), ["Warm Up", "Run", "Rest", "Cool Down"]);
  assert.equal(inside[0].repeat_group, 1);

  const outside = moveStepAcrossRepeatBoundary(inside, 0, 3);
  assert.deepEqual(outside.map((step) => step.name), ["Run", "Rest", "Warm Up", "Cool Down"]);
  assert.equal(outside[2].repeat_group, null);
});
