"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "@/lib/pdfjs";

interface PdfThumbnailProps {
  url: string;
  filename: string;
}

export default function PdfThumbnail({ url, filename }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function renderThumbnail() {
      try {
        const pdfjs = await loadPdfJs();
        if (isCancelled) return;

        const loadingTask = pdfjs.getDocument({ url, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (isCancelled) return;

        const page = await pdf.getPage(1);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Render at 2x resolution for retina display sharpness
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = 360;
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!isCancelled) {
          setLoaded(true);
        }
      } catch {
        if (!isCancelled) {
          setError(true);
        }
      }
    }

    void renderThumbnail();

    return () => {
      isCancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div className="settings-doc-card-fallback" aria-label={filename}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>PDF</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="settings-doc-card-loading" aria-hidden="true">
          <span className="settings-thumb-spinner" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="settings-doc-card-canvas"
        style={{
          display: loaded ? "block" : "none",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top center",
        }}
        aria-label={filename}
      />
    </>
  );
}
