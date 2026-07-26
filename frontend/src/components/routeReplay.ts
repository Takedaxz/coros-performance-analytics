export interface TimedRoutePoint {
  lat: number;
  lng: number;
  elapsed_s: number;
}

export interface RoutePosition {
  lat: number;
  lng: number;
  segmentIndex: number;
}

export function routePositionAt(
  points: TimedRoutePoint[],
  elapsedSeconds: number,
  segmentHint: number,
): RoutePosition {
  if (points.length < 2) {
    throw new RangeError("Route replay requires at least two timed points");
  }

  const lastIndex = points.length - 1;
  const elapsed = Math.max(points[0].elapsed_s, Math.min(elapsedSeconds, points[lastIndex].elapsed_s));
  let segmentIndex = Math.max(0, Math.min(segmentHint, lastIndex - 1));

  while (segmentIndex < lastIndex - 1 && points[segmentIndex + 1].elapsed_s <= elapsed) segmentIndex += 1;
  while (segmentIndex > 0 && points[segmentIndex].elapsed_s > elapsed) segmentIndex -= 1;

  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const segmentDuration = end.elapsed_s - start.elapsed_s;
  const progress = segmentDuration > 0 ? (elapsed - start.elapsed_s) / segmentDuration : 1;

  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lng: start.lng + (end.lng - start.lng) * progress,
    segmentIndex,
  };
}
