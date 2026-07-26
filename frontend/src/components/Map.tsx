"use client";

import { useEffect, useRef } from "react";

interface MapProps {
  points: Array<{ lat: number; lng: number }>;
}

export default function Map({ points }: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    // Load Leaflet CSS dynamically
    const linkId = "leaflet-css-link";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    let isMounted = true;

    // Load Leaflet JS dynamically to prevent SSR errors
    import("leaflet").then((L) => {
      const container = mapContainerRef.current;
      if (!isMounted || !container || !document.body.contains(container)) return;

      // Clean up previous instance safely if any
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.off();
          mapInstanceRef.current.remove();
        } catch {
          // Ignore Leaflet unmount cleanup errors if DOM container was modified by React
        }
        mapInstanceRef.current = null;
      }

      // Reset Leaflet internal container ID to prevent "Map container is already initialized"
      if ((container as any)._leaflet_id) {
        (container as any)._leaflet_id = null;
      }

      if (points.length === 0) return;

      // Filter out invalid coords
      const validPoints = points.filter(
        (p) =>
          typeof p.lat === "number" &&
          typeof p.lng === "number" &&
          !isNaN(p.lat) &&
          !isNaN(p.lng)
      );

      if (validPoints.length === 0) return;

      // Find center and initial bounds
      const latLngs = validPoints.map((p) => [p.lat, p.lng] as [number, number]);

      try {
        // Initialize Map
        const map = L.map(container, {
          zoomControl: true,
          scrollWheelZoom: true,
        });
        mapInstanceRef.current = map;

        // Add Tile Layer
        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 20,
          }
        ).addTo(map);

        // Draw Polyline Route
        const polyline = L.polyline(latLngs, {
          color: "#10b981",
          weight: 4,
          opacity: 0.9,
          lineJoin: "round",
        }).addTo(map);

        // Fit bounds with padding
        map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

        // Start and Finish markers
        const startPoint = latLngs[0];
        const endPoint = latLngs[latLngs.length - 1];

        L.circleMarker(startPoint, {
          radius: 6,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          color: "#ffffff",
          weight: 2,
        })
          .addTo(map)
          .bindPopup("Start");

        L.circleMarker(endPoint, {
          radius: 6,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          color: "#ffffff",
          weight: 2,
        })
          .addTo(map)
          .bindPopup("Finish");

        requestAnimationFrame(() => {
          if (isMounted && mapInstanceRef.current) {
            try {
              mapInstanceRef.current.invalidateSize();
            } catch {
              // Ignore sizing errors if map unmounted
            }
          }
        });
      } catch (err) {
        console.warn("Leaflet map initialization error:", err);
      }
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.off();
          mapInstanceRef.current.remove();
        } catch {
          // Ignore cleanup errors during unmount or Fast Refresh
        }
        mapInstanceRef.current = null;
      }
    };
  }, [points]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: "260px",
        borderRadius: "8px",
        zIndex: 1,
      }}
    />
  );
}
