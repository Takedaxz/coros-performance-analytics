"use client";

import { useState } from "react";

interface ImageViewerProps {
  url: string;
  filename: string;
}

export default function ImageViewer({ url, filename }: ImageViewerProps) {
  const [scale, setScale] = useState<number>(1.0);

  return (
    <div className="pdf-viewer-root image-viewer-root">
      <div className="pdf-viewer-toolbar">
        <span className="pdf-page-info">{filename}</span>
        <div className="pdf-toolbar-controls">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={() => setScale((s) => Math.max(0.25, parseFloat((s - 0.2).toFixed(2))))}
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
            onClick={() => setScale((s) => Math.min(4.0, parseFloat((s + 0.2).toFixed(2))))}
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

      <div className="pdf-scroll-area image-scroll-area">
        <div
          className="image-preview-wrapper"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center top",
            transition: "transform 120ms ease",
          }}
        >
          <img
            src={url}
            alt={filename}
            className="image-preview-element"
            loading="eager"
          />
        </div>
      </div>
    </div>
  );
}
