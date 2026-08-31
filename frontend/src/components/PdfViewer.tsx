"use client";

import { useEffect, useRef, useState } from "react";

interface PdfViewerProps {
  url: string;
  filename: string;
}

export default function PdfViewer({ url, filename }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);

      try {
        if (!(window as unknown as { pdfjsLib?: unknown }).pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load PDF engine"));
            document.head.appendChild(script);
          });
        }

        const pdfjs = (window as unknown as {
          pdfjsLib: {
            GlobalWorkerOptions: { workerSrc: string };
            getDocument: (options: { url: string; withCredentials?: boolean }) => {
              promise: Promise<{
                numPages: number;
                getPage: (num: number) => Promise<{
                  getViewport: (options: { scale: number }) => { width: number; height: number };
                  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
                }>;
              }>;
            };
          };
        }).pdfjsLib;

        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        const loadingTask = pdfjs.getDocument({
          url,
          withCredentials: false,
        });

        const pdf = await loadingTask.promise;
        if (isCancelled) return;

        setNumPages(pdf.numPages);
        setLoading(false);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        const dpr = typeof window !== "undefined" ? Math.max(window.devicePixelRatio || 1, 2) : 2;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (isCancelled) return;
          const page = await pdf.getPage(pageNum);
          const renderScale = scale * dpr;
          const viewport = page.getViewport({ scale: renderScale });
          const displayWidth = Math.floor(viewport.width / dpr);
          const displayHeight = Math.floor(viewport.height / dpr);

          const pageWrapper = document.createElement("div");
          pageWrapper.className = "pdf-page-wrapper";
          pageWrapper.style.marginBottom = "20px";
          pageWrapper.style.display = "flex";
          pageWrapper.style.flexDirection = "column";
          pageWrapper.style.alignItems = "center";

          const canvas = document.createElement("canvas");
          canvas.className = "pdf-page-canvas";
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${displayWidth}px`;
          canvas.style.height = `${displayHeight}px`;
          canvas.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.25)";
          canvas.style.borderRadius = "4px";
          canvas.style.background = "#FFFFFF";

          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({
              canvasContext: ctx,
              viewport,
            }).promise;
          }

          pageWrapper.appendChild(canvas);
          container.appendChild(pageWrapper);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : "Could not load PDF";
          setError(message);
          setLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [url, scale]);

  return (
    <div className="pdf-viewer-root">
      <div className="pdf-viewer-toolbar">
        <span className="pdf-page-info">
          {numPages > 0 ? `${numPages} Page${numPages > 1 ? "s" : ""}` : filename}
        </span>
        <div className="pdf-toolbar-controls">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={() => setScale((s) => Math.max(0.6, parseFloat((s - 0.15).toFixed(2))))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={() => setScale((s) => Math.min(3.0, parseFloat((s + 0.15).toFixed(2))))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={() => setScale(1.0)}
            title="Reset Zoom to 100%"
          >
            100%
          </button>
        </div>
      </div>

      <div className="pdf-scroll-area">
        {loading && (
          <div className="pdf-loading-state">
            <span className="pdf-loading-spinner" />
            <span>Rendering PDF...</span>
          </div>
        )}
        {error && (
          <div className="pdf-error-state">
            <p>Could not render preview directly.</p>
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: "12px", display: "inline-flex" }}>
              Open PDF in New Tab
            </a>
          </div>
        )}
        <div ref={containerRef} className="pdf-pages-container" />
      </div>
    </div>
  );
}
