"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CircleMarker, LatLngBounds, Map as LeafletMap, Polyline } from "leaflet";
import type { GeoJSONSource, Map as MapLibreMap, Marker, Popup, StyleSpecification } from "maplibre-gl";
import { routePositionAt, type TimedRoutePoint } from "./routeReplay";
import { openFreeMapStyleUrl, type Theme } from "@/lib/theme";
import { SATELLITE_STYLE } from "@/lib/satelliteStyle";

interface RoutePoint {
  lat: number;
  lng: number;
  elapsed_s?: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
  power_w?: number;
}

interface MapProps {
  points: RoutePoint[];
  sport?: string;
  showTelemetryPopup?: boolean;
  basemap: "map" | "satellite";
  onBasemapChange: (value: "map" | "satellite") => void;
  terrain3D?: boolean;
  onTerrain3DChange?: (value: boolean) => void;
  onExpand?: () => void;
}

type PlaybackSpeed = 1 | 10 | 25 | 50 | 100;

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

function normalizedTimedRoutePoints(points: RoutePoint[]): TimedRoutePoint[] {
  const timedPoints = points.filter(isTimedPoint);
  const firstElapsed = timedPoints[0]?.elapsed_s ?? 0;
  return timedPoints.map((point) => ({ ...point, elapsed_s: point.elapsed_s - firstElapsed }));
}

function basemapStyle(theme: Theme, basemap: "map" | "satellite"): string | StyleSpecification {
  return basemap === "satellite" ? SATELLITE_STYLE : openFreeMapStyleUrl(theme);
}

function terrainMarkerElement(kind: "start" | "finish" | "runner"): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `activity-route-terrain-marker is-${kind}`;
  return element;
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

function telemetryMetric(speedMps?: number, sport?: string): { label: string; value: string } {
  const isRide = sport === "ride";
  const label = isRide ? "Speed" : "Pace";
  if (!speedMps || speedMps <= 0) return { label, value: "--" };
  if (isRide) return { label, value: `${(speedMps * 3.6).toFixed(1)} km/h` };
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return { label, value: `${min}:${sec.toString().padStart(2, "0")} /km` };
}

function telemetryPopupHtml(speedMps?: number, heartRateBpm?: number, sport?: string, powerW?: number): string {
  const metric = telemetryMetric(speedMps, sport);
  const heartRate = heartRateBpm != null ? `${heartRateBpm} bpm` : "--";
  const isRide = sport === "ride";
  const powerHtml = isRide
    ? `<div class="runner-telemetry-item"><span class="runner-telemetry-label">Power</span><strong class="runner-telemetry-value">${powerW != null ? `${Math.round(powerW)} W` : "--"}</strong></div>`
    : "";
  return `<div class="runner-telemetry-content"><div class="runner-telemetry-item"><span class="runner-telemetry-label">${metric.label}</span><strong class="runner-telemetry-value">${metric.value}</strong></div><div class="runner-telemetry-item"><span class="runner-telemetry-label">HR</span><strong class="runner-telemetry-value">${heartRate}</strong></div>${powerHtml}</div>`;
}

export default function Map({ points, sport, showTelemetryPopup = true, basemap, onBasemapChange, terrain3D = false, onTerrain3DChange, onExpand }: MapProps) {
  const isTerrain3D = terrain3D;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const elapsedLabelRef = useRef<HTMLSpanElement>(null);
  const progressInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const terrainMapRef = useRef<MapLibreMap | null>(null);
  const terrainStartMarkerRef = useRef<Marker | null>(null);
  const terrainFinishMarkerRef = useRef<Marker | null>(null);
  const terrainRunnerMarkerRef = useRef<Marker | null>(null);
  const terrainRunnerPopupRef = useRef<Popup | null>(null);
  const terrainBoundsRef = useRef<[[number, number], [number, number]] | null>(null);
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
  const preservePlaybackOnMapChangeRef = useRef(false);
  const resumePlaybackOnMapChangeRef = useRef(false);
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
    if (terrainRunnerMarkerRef.current || runnerMarkerRef.current) {
      if (showTelemetryPopup) {
        renderPlayback(playbackRef.current.elapsedSeconds);
      } else if (terrainRunnerPopupRef.current) {
        terrainRunnerPopupRef.current.remove();
      } else if (runnerMarkerRef.current) {
        runnerMarkerRef.current.closePopup();
      }
    }
  }, [showTelemetryPopup]);

  const renderPlayback = (elapsedSeconds: number): void => {
    const replayPoints = timedPointsRef.current;
    if (replayPoints.length < 2) return;

    const position = routePositionAt(replayPoints, elapsedSeconds, segmentIndexRef.current);
    segmentIndexRef.current = position.segmentIndex;
    const currentPoint: [number, number] = [position.lat, position.lng];
    const completedPoints = replayPoints
      .slice(0, position.segmentIndex + 1)
      .map((point): [number, number] => [point.lat, point.lng]);

    const terrainProgressSource = terrainMapRef.current?.getSource("activity-route-progress");
    if (terrainProgressSource && terrainRunnerMarkerRef.current) {
      (terrainProgressSource as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [...completedPoints, currentPoint].map(([lat, lng]) => [lng, lat]),
        },
      });
      terrainRunnerMarkerRef.current.setLngLat([currentPoint[1], currentPoint[0]]);
      const popup = terrainRunnerPopupRef.current;
      if (popup && showTelemetryPopupRef.current) {
        popup
          .setLngLat([currentPoint[1], currentPoint[0]])
          .setHTML(telemetryPopupHtml(position.speed_mps, position.heart_rate_bpm, sport, position.power_w));
        if (!popup.isOpen()) popup.addTo(terrainMapRef.current!);
      } else {
        popup?.remove();
      }
    } else if (progressLineRef.current && runnerMarkerRef.current) {
      progressLineRef.current.setLatLngs([...completedPoints, currentPoint]);
      runnerMarkerRef.current.setLatLng(currentPoint);

      if (showTelemetryPopupRef.current) {
        const popupHtml = telemetryPopupHtml(position.speed_mps, position.heart_rate_bpm, sport, position.power_w);

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
    } else {
      return;
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
    const hasReplayRenderer = Boolean(
      (progressLineRef.current && runnerMarkerRef.current)
      || (terrainMapRef.current && terrainRunnerMarkerRef.current),
    );
    if (!canReplay || !hasReplayRenderer || playbackRef.current.playing) return;
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

  const resumePlaybackAfterMapChange = (): void => {
    if (!resumePlaybackOnMapChangeRef.current) return;
    resumePlaybackOnMapChangeRef.current = false;
    playbackRef.current.startedAtMs = 0;
    playbackRef.current.startedElapsedSeconds = playbackRef.current.elapsedSeconds;
    playbackRef.current.playing = true;
    setIsPlaying(true);
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const preservePlaybackForMapChange = (): void => {
    preservePlaybackOnMapChangeRef.current = true;
    resumePlaybackOnMapChangeRef.current = playbackRef.current.playing;
    cancelAnimation();
    setIsPlaying(false);
  };

  const toggleTerrain = (): void => {
    preservePlaybackForMapChange();
    onTerrain3DChange?.(!isTerrain3D);
  };

  const toggleBasemap = (): void => {
    preservePlaybackForMapChange();
    onBasemapChange(basemap === "map" ? "satellite" : "map");
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
    if (terrainMapRef.current && terrainBoundsRef.current) {
      terrainMapRef.current.fitBounds(terrainBoundsRef.current, {
        animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        duration: 350,
        padding: 40,
        pitch: 65,
      });
      return;
    }

    const map = mapInstanceRef.current;
    const bounds = routeBoundsRef.current;
    if (!map || !bounds) return;

    map.fitBounds(bounds, {
      animate: false,
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
    let resizeFrame: number | null = null;
    let leafletMap: LeafletMap | null = null;
    const preservePlayback = preservePlaybackOnMapChangeRef.current;
    preservePlaybackOnMapChangeRef.current = false;
    cancelAnimation();
    if (!preservePlayback) {
      playbackRef.current.elapsedSeconds = 0;
      segmentIndexRef.current = 0;
    }

    if (isTerrain3D) {
      import("maplibre-gl").then((maplibregl) => {
        const container = mapContainerRef.current;
        if (!isMounted || !container || !document.body.contains(container)) return;

        const validPoints = points.filter(
          (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
        );
        if (validPoints.length === 0) return;

        const normalizedTimedPoints = normalizedTimedRoutePoints(validPoints);
        timedPointsRef.current = normalizedTimedPoints;
        durationRef.current = normalizedTimedPoints.length > 1
          ? normalizedTimedPoints[normalizedTimedPoints.length - 1].elapsed_s
          : 0;

        const coordinates = validPoints.map((point): [number, number] => [point.lng, point.lat]);
        const lngs = coordinates.map(([lng]) => lng);
        const lats = coordinates.map(([, lat]) => lat);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ];
        terrainBoundsRef.current = bounds;

        const currentTheme = (): Theme =>
          document.documentElement.dataset.theme === "light" ? "light" : "dark";
        const map = new maplibregl.Map({
          container,
          style: basemapStyle(currentTheme(), basemap),
          attributionControl: { compact: true },
          center: coordinates[0],
          zoom: 12,
          pitch: 65,
          bearing: -18,
          maxPitch: 85,
        });
        terrainMapRef.current = map;

        // Mirror the 2D map's theme observer so style updates without a remount
        themeObserver = new MutationObserver(() => {
          map.setStyle(basemapStyle(currentTheme(), basemap));
          // Re-add route sources/layers after style reload
          map.once("style.load", () => {
            if (!isMounted) return;
            map.addSource("terrain-dem", {
              type: "raster-dem",
              url: "https://tiles.mapterhorn.com/tilejson.json",
            });
            map.setTerrain({ source: "terrain-dem", exaggeration: 1.2 });
            map.addSource("activity-route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates },
              },
            });
            map.addLayer({
              id: "activity-route",
              type: "line",
              source: "activity-route",
              paint: {
                "line-color": "#21E6A5",
                "line-width": 5,
                "line-opacity": normalizedTimedPoints.length > 1 ? 0.24 : 0.95,
              },
            });
            if (normalizedTimedPoints.length > 1) {
              const completedCoords = timedPointsRef.current
                .slice(0, segmentIndexRef.current + 1)
                .map((p): [number, number] => [p.lng, p.lat]);
              map.addSource("activity-route-progress", {
                type: "geojson",
                data: {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: completedCoords.length > 0 ? completedCoords : [coordinates[0]],
                  },
                },
              });
              map.addLayer({
                id: "activity-route-progress",
                type: "line",
                source: "activity-route-progress",
                paint: { "line-color": "#21E6A5", "line-width": 5, "line-opacity": 0.95 },
              });
            }
          });
        });
        themeObserver.observe(document.documentElement, {
          attributeFilter: ["data-theme"],
          attributes: true,
        });

        map.on("load", () => {
          if (!isMounted) return;
          map.addSource("terrain-dem", {
            type: "raster-dem",
            url: "https://tiles.mapterhorn.com/tilejson.json",
          });
          map.setTerrain({ source: "terrain-dem", exaggeration: 1.2 });
          map.addSource("activity-route", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          });
          map.addLayer({
            id: "activity-route",
            type: "line",
            source: "activity-route",
            paint: {
              "line-color": "#21E6A5",
              "line-width": 5,
              "line-opacity": normalizedTimedPoints.length > 1 ? 0.24 : 0.95,
            },
          });
          terrainStartMarkerRef.current = new maplibregl.Marker({
            element: terrainMarkerElement("start"),
            anchor: "center",
          })
            .setLngLat(coordinates[0])
            .addTo(map);
          terrainFinishMarkerRef.current = new maplibregl.Marker({
            element: terrainMarkerElement("finish"),
            anchor: "center",
          })
            .setLngLat(coordinates[coordinates.length - 1])
            .addTo(map);
          if (normalizedTimedPoints.length > 1) {
            map.addSource("activity-route-progress", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: [coordinates[0]] },
              },
            });
            map.addLayer({
              id: "activity-route-progress",
              type: "line",
              source: "activity-route-progress",
              paint: { "line-color": "#21E6A5", "line-width": 5, "line-opacity": 0.95 },
            });
            terrainRunnerMarkerRef.current = new maplibregl.Marker({
              element: terrainMarkerElement("runner"),
              anchor: "center",
            })
              .setLngLat(coordinates[0])
              .addTo(map);
            terrainRunnerPopupRef.current = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              className: "runner-telemetry-popup",
              offset: 8,
            })
              .setLngLat(coordinates[0])
              .setHTML(telemetryPopupHtml(normalizedTimedPoints[0].speed_mps, normalizedTimedPoints[0].heart_rate_bpm, sport, normalizedTimedPoints[0].power_w));
            renderPlayback(playbackRef.current.elapsedSeconds);
            resumePlaybackAfterMapChange();
          }
          map.fitBounds(bounds, { padding: 40, pitch: 65, duration: 0 });
          map.once("idle", () => {
            if (!isMounted) return;
            map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
            terrainStartMarkerRef.current?.setLngLat(coordinates[0]);
            terrainFinishMarkerRef.current?.setLngLat(coordinates[coordinates.length - 1]);
            renderPlayback(playbackRef.current.elapsedSeconds);
            map.triggerRepaint();
          });
        });
      }).catch(() => onTerrain3DChange?.(false));

      return () => {
        isMounted = false;
        themeObserver?.disconnect();
        terrainBoundsRef.current = null;
        terrainStartMarkerRef.current = null;
        terrainFinishMarkerRef.current = null;
        terrainRunnerMarkerRef.current = null;
        terrainRunnerPopupRef.current?.remove();
        terrainRunnerPopupRef.current = null;
        terrainMapRef.current?.remove();
        terrainMapRef.current = null;
      };
    }


    Promise.all([
      import("leaflet"),
      import("@maplibre/maplibre-gl-leaflet"),
    ]).then(([L, { default: maplibreGL }]) => {
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
      const normalizedTimedPoints = normalizedTimedRoutePoints(validPoints);
      timedPointsRef.current = normalizedTimedPoints;
      durationRef.current = normalizedTimedPoints.length > 1
        ? normalizedTimedPoints[normalizedTimedPoints.length - 1].elapsed_s
        : 0;

      const map = L.map(container, {
        zoomControl: true,
        scrollWheelZoom: true,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      leafletMap = map;
      mapInstanceRef.current = map;

      const currentTheme = (): Theme =>
        document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const basemapLayer = maplibreGL({
        style: basemapStyle(currentTheme(), basemap),
        interactive: false,
      }).addTo(map);
      themeObserver = new MutationObserver(() => {
        basemapLayer.getMaplibreMap().setStyle(basemapStyle(currentTheme(), basemap));
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
        renderPlayback(playbackRef.current.elapsedSeconds);
        resumePlaybackAfterMapChange();
      }

      resizeFrame = requestAnimationFrame(() => {
        if (isMounted && mapInstanceRef.current === map && routeBoundsRef.current) {
          map.invalidateSize();
          map.fitBounds(routeBoundsRef.current, { padding: [20, 20] });
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
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      cancelAnimation();
      if (leafletMap && mapInstanceRef.current === leafletMap) {
        progressLineRef.current = null;
        runnerMarkerRef.current = null;
        routeBoundsRef.current = null;
        timedPointsRef.current = [];
        leafletMap.off();
        leafletMap.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points, isTerrain3D, basemap]);

  return (
    <div className={canReplay ? "activity-route-shell has-replay" : "activity-route-shell"}>
      <div
        ref={mapContainerRef}
        className="activity-route-map"
      />
      <div className="activity-route-map-actions">
        <button
          aria-label={basemap === "satellite" ? "Show street map" : "Show satellite map"}
          aria-pressed={basemap === "satellite"}
          className={`activity-route-terrain-toggle${basemap === "satellite" ? " is-active" : ""}`}
          onClick={toggleBasemap}
          title={basemap === "satellite" ? "Street map" : "Satellite map"}
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12.83 2.18 8.58 3.9a1 1 0 0 1 0 1.83l-8.58 3.91a2 2 0 0 1-1.66 0L2.59 7.91a1 1 0 0 1 0-1.83l8.58-3.9a2 2 0 0 1 1.66 0Z" />
            <path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5M22 17.5l-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5" />
          </svg>
        </button>
        <button
          aria-label={isTerrain3D ? "Switch to flat map" : "Show 3D terrain map"}
          aria-pressed={isTerrain3D}
          className={`activity-route-terrain-toggle${isTerrain3D ? " is-active" : ""}`}
          onClick={toggleTerrain}
          title={isTerrain3D ? "Flat map" : "3D terrain (experimental)"}
          type="button"
        >
          3D
        </button>
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
              {([1, 10, 25, 50, 100] as const).map((speed) => (
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
