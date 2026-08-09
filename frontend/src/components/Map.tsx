"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CircleMarker, LatLngBounds, Map as LeafletMap, Polyline } from "leaflet";
import { routePositionAt, type TimedRoutePoint } from "./routeReplay";
import { cartoBasemapUrl, type Theme } from "@/lib/theme";

interface RoutePoint {
  lat: number;
  lng: number;
  elapsed_s?: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
}

interface MapProps {
  points: RoutePoint[];
  showTelemetryPopup?: boolean;
  onExpand?: () => void;
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

function formatPacePopup(speedMps?: number): string {
  if (!speedMps || speedMps <= 0) return "--";
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")} /km`;
}

export default function Map({ points, showTelemetryPopup = true, onExpand }: MapProps) {
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
  const showTelemetryPopupRef = useRef(showTelemetryPopup);

  const timedPoints = points.filter(isTimedPoint);
  const replayDuration = timedPoints.length > 1
    ? Math.max(0, timedPoints[timedPoints.length - 1].elapsed_s - timedPoints[0].elapsed_s)
    : 0;
  const canReplay = replayDuration > 0;

  useEffect(() => {
    showTelemetryPopupRef.current = showTelemetryPopup;
    if (runnerMarkerRef.current) {
      if (showTelemetryPopup) {
        renderPlayback(playbackRef.current.elapsedSeconds);
      } else {
        runnerMarkerRef.current.closePopup();
      }
    }
  }, [showTelemetryPopup]);

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

    if (showTelemetryPopupRef.current) {
      const paceStr = formatPacePopup(position.speed_mps);
      const hrStr = position.heart_rate_bpm != null ? `${position.heart_rate_bpm} bpm` : "--";
      const popupHtml = `<div class="runner-telemetry-content"><div class="runner-telemetry-item"><span class="runner-telemetry-label">Pace</span><strong class="runner-telemetry-value">${paceStr}</strong></div><div class="runner-telemetry-item"><span class="runner-telemetry-label">HR</span><strong class="runner-telemetry-value">${hrStr}</strong></div></div>`;

      if (!runnerMarkerRef.current.getPopup()) {
        runnerMarkerRef.current.bindPopup(popupHtml, {
          autoPan: false,
          closeButton: false,
          closeOnClick: false,
          className: "runner-telemetry-popup",
          offset: [0, -8],
        });
      } else {
        runnerMarkerRef.current.setPopupContent(popupHtml);
      }
      if (!runnerMarkerRef.current.isPopupOpen()) {
        runnerMarkerRef.current.openPopup();
      }
    } else {
      runnerMarkerRef.current.closePopup();
    }

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
      const totalDurationStr = durationRef.current > 0 ? formatReplayTime(durationRef.current) : undefined;

      const startPopupHtml = `<div class="route-marker-popup-content start-marker"><div class="route-marker-header"><span class="route-marker-dot start-dot"></span><strong>Start</strong></div><span class="route-marker-sub">0:00 elapsed</span></div>`;
      const finishPopupHtml = `<div class="route-marker-popup-content finish-marker"><div class="route-marker-header"><span class="route-marker-dot finish-dot"></span><strong>Finish</strong></div>${totalDurationStr ? `<span class="route-marker-sub">${totalDurationStr} total</span>` : ""}</div>`;

      L.circleMarker(startPoint, {
        radius: 6,
        fillColor: "#2D9BF0",
        fillOpacity: 1,
        color: "#131A1E",
        weight: 2,
      }).addTo(map).bindPopup(startPopupHtml, {
        className: "route-marker-popup",
        autoPan: false,
        offset: [0, -6],
      });
      L.circleMarker(endPoint, {
        radius: 6,
        fillColor: "#F0D348",
        fillOpacity: 1,
        color: "#131A1E",
        weight: 2,
      }).addTo(map).bindPopup(finishPopupHtml, {
        className: "route-marker-popup",
        autoPan: false,
        offset: [0, -6],
      });

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
        if (isMounted && mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
          mapInstanceRef.current.fitBounds(routeBoundsRef.current!, { padding: [20, 20] });
          const zoomInBtn = container.querySelector(".leaflet-control-zoom-in");
          const zoomOutBtn = container.querySelector(".leaflet-control-zoom-out");
          if (zoomInBtn) {
            zoomInBtn.innerHTML = `<svg viewBox="0 0 512 512" width="13" height="13" aria-hidden="true"><path d="M256 112v288M112 256h288" stroke="currentColor" stroke-width="44" stroke-linecap="round" fill="none"/></svg>`;
          }
          if (zoomOutBtn) {
            zoomOutBtn.innerHTML = `<svg viewBox="0 0 512 512" width="13" height="13" aria-hidden="true"><path d="M112 256h288" stroke="currentColor" stroke-width="44" stroke-linecap="round" fill="none"/></svg>`;
          }
        }
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
      <div className="activity-route-map-actions">
        <button
          aria-label="Reset map view"
          className="activity-route-reset"
          onClick={resetMapView}
          title="Show full route"
          type="button"
        >
          <svg viewBox="0 0 512 512" aria-hidden="true">
            <circle cx="256" cy="256" r="144" stroke="currentColor" strokeWidth="36" fill="none" />
            <circle cx="256" cy="256" r="44" fill="currentColor" />
            <path d="M256 64v48M256 400v48M64 256h48M400 256h48" stroke="currentColor" strokeWidth="36" strokeLinecap="round" />
          </svg>
        </button>
        {onExpand && (
          <button
            aria-label="Expand map view"
            className="activity-route-reset"
            onClick={onExpand}
            title="Expand to full screen"
            type="button"
          >
            <svg viewBox="0 0 512 512" aria-hidden="true">
              <path d="M384 224V128H288M384 128L272 240M128 288v96h96M128 384l112-112" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
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
                <svg viewBox="0 0 512 512" aria-hidden="true">
                  <path d="M144 96h80v320h-80zM288 96h80v320h-80z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 512 512" aria-hidden="true">
                  <path d="M128 96v320l288-160z" fill="currentColor" />
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
              <svg viewBox="0 0 512 512" aria-hidden="true">
                <path d="M400 256A144 144 0 1 1 364 154M400 96v72h-72" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
