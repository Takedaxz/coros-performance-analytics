export interface TimedRoutePoint {
  lat: number;
  lng: number;
  elapsed_s: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
}

export interface RoutePosition {
  lat: number;
  lng: number;
  segmentIndex: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
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

  const hr = start.heart_rate_bpm != null && end.heart_rate_bpm != null
    ? Math.round(start.heart_rate_bpm + (end.heart_rate_bpm - start.heart_rate_bpm) * progress)
    : start.heart_rate_bpm ?? end.heart_rate_bpm;

  const speed = start.speed_mps != null && end.speed_mps != null
    ? start.speed_mps + (end.speed_mps - start.speed_mps) * progress
    : start.speed_mps ?? end.speed_mps;

  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lng: start.lng + (end.lng - start.lng) * progress,
    segmentIndex,
    heart_rate_bpm: hr,
    speed_mps: speed,
  };
}

