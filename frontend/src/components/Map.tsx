"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CircleMarker, LatLngBounds, Map as LeafletMap, Polyline } from "leaflet";
import { routePositionAt, type TimedRoutePoint } from "./routeReplay";
import { cartoBasemapUrl, type Theme } from "@/lib/theme";

interface RoutePoint {
  lat: number;
  lng: number;
  elapsed_s?: number;
}

interface MapProps {
  points: RoutePoint[];
}

type PlaybackSpeed = 25 | 50 | 100;

interface PlaybackState {
  elapsedSeconds: number;
  startedAtMs: number;
  startedElapsedSeconds: number;
  speed: PlaybackSpeed;
  playing: boolean;
}

function isTimedPoint(point: RoutePoint): point is TimedRoutePoint {
  return typeof point.elapsed_s === "number" && Number.isFinite(point.elapsed_s);
}

function formatReplayTime(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default function Map({ points }: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const elapsedLabelRef = useRef<HTMLSpanElement>(null);
  const progressInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const routeBoundsRef = useRef<LatLngBounds | null>(null);
  const progressLineRef = useRef<Polyline | null>(null);
  const runnerMarkerRef = useRef<CircleMarker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timedPointsRef = useRef<TimedRoutePoint[]>([]);
  const durationRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const playbackRef = useRef<PlaybackState>({
    elapsedSeconds: 0,
    startedAtMs: 0,
    startedElapsedSeconds: 0,
    speed: 25,
    playing: false,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(25);

  const timedPoints = points.filter(isTimedPoint);
  const replayDuration = timedPoints.length > 1
    ? Math.max(0, timedPoints[timedPoints.length - 1].elapsed_s - timedPoints[0].elapsed_s)
    : 0;
  const canReplay = replayDuration > 0;

  const renderPlayback = (elapsedSeconds: number): void => {
    const replayPoints = timedPointsRef.current;
    if (replayPoints.length < 2 || !progressLineRef.current || !runnerMarkerRef.current) return;

    const position = routePositionAt(replayPoints, elapsedSeconds, segmentIndexRef.current);
    segmentIndexRef.current = position.segmentIndex;
    const currentPoint: [number, number] = [position.lat, position.lng];
    const completedPoints = replayPoints
      .slice(0, position.segmentIndex + 1)
      .map((point): [number, number] => [point.lat, point.lng]);

    progressLineRef.current.setLatLngs([...completedPoints, currentPoint]);
    runnerMarkerRef.current.setLatLng(currentPoint);
    if (elapsedLabelRef.current) {
      elapsedLabelRef.current.textContent = `${formatReplayTime(elapsedSeconds)} / ${formatReplayTime(durationRef.current)}`;
    }
    if (progressInputRef.current) progressInputRef.current.value = String(elapsedSeconds);
  };

  const animate = (nowMs: number): void => {
    const playback = playbackRef.current;
    if (!playback.playing) return;
    if (playback.startedAtMs === 0) playback.startedAtMs = nowMs;

    const elapsedSeconds = Math.min(
      durationRef.current,
      playback.startedElapsedSeconds + ((nowMs - playback.startedAtMs) / 1000) * playback.speed,
    );
    playback.elapsedSeconds = elapsedSeconds;
    renderPlayback(elapsedSeconds);

    if (elapsedSeconds >= durationRef.current) {
      playback.playing = false;
      animationFrameRef.current = null;
      setIsPlaying(false);
      return;
    }
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const cancelAnimation = (): void => {
    playbackRef.current.playing = false;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const play = (): void => {
    if (!canReplay || !progressLineRef.current || !runnerMarkerRef.current || playbackRef.current.playing) return;
    if (playbackRef.current.elapsedSeconds >= durationRef.current) {
      playbackRef.current.elapsedSeconds = 0;
      segmentIndexRef.current = 0;
      renderPlayback(0);
    }

    playbackRef.current.startedAtMs = 0;
    playbackRef.current.startedElapsedSeconds = playbackRef.current.elapsedSeconds;
    playbackRef.current.playing = true;
    setIsPlaying(true);
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const pause = (): void => {
    const playback = playbackRef.current;
    if (!playback.playing) return;

    cancelAnimation();
    renderPlayback(playback.elapsedSeconds);
    setIsPlaying(false);
  };

  const restart = (): void => {
    cancelAnimation();
    playbackRef.current.elapsedSeconds = 0;
    segmentIndexRef.current = 0;
    renderPlayback(0);
    setIsPlaying(false);
  };

  const changeSpeed = (speed: PlaybackSpeed): void => {
    const playback = playbackRef.current;
    if (playback.playing) {
      playback.startedElapsedSeconds = playback.elapsedSeconds;
      playback.startedAtMs = 0;
    }
    playback.speed = speed;
    setPlaybackSpeed(speed);
  };

  const seek = (event: ChangeEvent<HTMLInputElement>): void => {
    const elapsedSeconds = Number(event.currentTarget.value);
    playbackRef.current.elapsedSeconds = elapsedSeconds;
    if (playbackRef.current.playing) {
      playbackRef.current.startedElapsedSeconds = elapsedSeconds;
      playbackRef.current.startedAtMs = 0;
    }
    renderPlayback(elapsedSeconds);
  };

  const resetMapView = (): void => {
    const map = mapInstanceRef.current;
    const bounds = routeBoundsRef.current;
    if (!map || !bounds) return;

    map.fitBounds(bounds, {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      duration: 0.35,
      padding: [20, 20],
    });
  };

  useEffect(() => {
    const linkId = "leaflet-css-link";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    let isMounted = true;
    let themeObserver: MutationObserver | null = null;
    cancelAnimation();
    playbackRef.current.elapsedSeconds = 0;
    segmentIndexRef.current = 0;

    import("leaflet").then((L) => {
      const container = mapContainerRef.current;
      if (!isMounted || !container || !document.body.contains(container)) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.off();
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const leafletContainer = container as HTMLDivElement & { _leaflet_id?: number | null };
      if (leafletContainer._leaflet_id) leafletContainer._leaflet_id = null;

      const validPoints = points.filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lng),
      );
      if (validPoints.length === 0) return;

      const latLngs = validPoints.map((point): [number, number] => [point.lat, point.lng]);
      const timedRoutePoints = validPoints.filter(isTimedPoint);
      const firstElapsed = timedRoutePoints[0]?.elapsed_s ?? 0;
      const normalizedTimedPoints = timedRoutePoints.map((point) => ({
        ...point,
        elapsed_s: point.elapsed_s - firstElapsed,
      }));
      timedPointsRef.current = normalizedTimedPoints;
      durationRef.current = normalizedTimedPoints.length > 1
        ? normalizedTimedPoints[normalizedTimedPoints.length - 1].elapsed_s
        : 0;

      const map = L.map(container, {
        zoomControl: true,
        scrollWheelZoom: true,
      });
      mapInstanceRef.current = map;

      const currentTheme = (): Theme =>
        document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const tileLayer = L.tileLayer(cartoBasemapUrl(currentTheme()), {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);
      themeObserver = new MutationObserver(() => {
        tileLayer.setUrl(cartoBasemapUrl(currentTheme()));
      });
      themeObserver.observe(document.documentElement, {
        attributeFilter: ["data-theme"],
        attributes: true,
      });

      const fullRoute = L.polyline(latLngs, {
        color: "#21E6A5",
        weight: 4,
        opacity: normalizedTimedPoints.length > 1 ? 0.24 : 0.9,
        lineJoin: "round",
      }).addTo(map);
      routeBoundsRef.current = fullRoute.getBounds();
      map.fitBounds(routeBoundsRef.current, { padding: [20, 20] });

      const startPoint = latLngs[0];
      const endPoint = latLngs[latLngs.length - 1];
      L.circleMarker(startPoint, {
        radius: 6,
        fillColor: "#2D9BF0",
        fillOpacity: 1,
        color: "#131A1E",
        weight: 2,
      }).addTo(map).bindPopup("Start");
      L.circleMarker(endPoint, {
        radius: 6,
        fillColor: "#F0D348",
        fillOpacity: 1,
        color: "#131A1E",
        weight: 2,
      }).addTo(map).bindPopup("Finish");

      if (normalizedTimedPoints.length > 1) {
        const replayStart: [number, number] = [
          normalizedTimedPoints[0].lat,
          normalizedTimedPoints[0].lng,
        ];
        progressLineRef.current = L.polyline([replayStart], {
          color: "#21E6A5",
          weight: 4,
          opacity: 0.95,
          lineJoin: "round",
        }).addTo(map);
        runnerMarkerRef.current = L.circleMarker(replayStart, {
          radius: 7,
          fillColor: "#21E6A5",
          fillOpacity: 1,
          color: "#131A1E",
          weight: 3,
        }).addTo(map);
        renderPlayback(0);
      }

      requestAnimationFrame(() => {
        if (isMounted && mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
      });
    });

    return () => {
      isMounted = false;
      themeObserver?.disconnect();
      cancelAnimation();
      progressLineRef.current = null;
      runnerMarkerRef.current = null;
      routeBoundsRef.current = null;
      timedPointsRef.current = [];
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off();
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points]);

  return (
    <div className={canReplay ? "activity-route-shell has-replay" : "activity-route-shell"}>
      <div
        ref={mapContainerRef}
        className="activity-route-map"
      />
      <button
        aria-label="Reset map view"
        className="activity-route-reset"
        onClick={resetMapView}
        title="Show full route"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
          <circle cx="10" cy="10" r="2.25" />
        </svg>
      </button>
      {canReplay && (
        <div className="route-replay-controls" aria-label="Route replay controls">
          <input
            ref={progressInputRef}
            className="route-replay-progress"
            type="range"
            min="0"
            max={replayDuration}
            step="0.1"
            defaultValue="0"
            aria-label="Replay position"
            onChange={seek}
          />
          <div className="route-replay-toolbar">
            <button
              type="button"
              className="route-replay-button route-replay-icon-button route-replay-primary"
              aria-label={isPlaying ? "Pause replay" : "Play replay"}
              title={isPlaying ? "Pause" : "Play"}
              onClick={isPlaying ? pause : play}
            >
              {isPlaying ? (
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="5" y="4" width="3.5" height="12" rx="1" />
                  <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6 4.5 15 10 6 15.5Z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="route-replay-button route-replay-icon-button route-replay-restart-button"
              aria-label="Restart replay"
              title="Restart"
              onClick={restart}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.5 6.5A7 7 0 1 1 3 12" />
                <path d="M4.5 2.5v4h-4" />
              </svg>
            </button>
            <span ref={elapsedLabelRef} className="route-replay-time">
              0:00 / {formatReplayTime(replayDuration)}
            </span>
            <div className="route-replay-speeds" aria-label="Playback speed">
              {([25, 50, 100] as const).map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={playbackSpeed === speed ? "is-active" : ""}
                  aria-pressed={playbackSpeed === speed}
                  onClick={() => changeSpeed(speed)}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
