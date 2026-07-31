import assert from "node:assert/strict";
import { routePositionAt } from "../src/components/routeReplay.ts";

const points = [
  { lat: 0, lng: 0, elapsed_s: 0 },
  { lat: 10, lng: 20, elapsed_s: 10 },
  { lat: 20, lng: 40, elapsed_s: 20 },
];

assert.deepEqual(routePositionAt(points, 5, 0), { lat: 5, lng: 10, segmentIndex: 0 });
assert.deepEqual(routePositionAt(points, 15, 0), { lat: 15, lng: 30, segmentIndex: 1 });
assert.deepEqual(routePositionAt(points, 5, 1), { lat: 5, lng: 10, segmentIndex: 0 });
assert.deepEqual(routePositionAt(points, 30, 1), { lat: 20, lng: 40, segmentIndex: 1 });
