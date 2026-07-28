"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function PageTitle({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <div className="page-title-group">
      <button className="page-back-button" type="button" onClick={() => router.back()} aria-label="Go back" title="Go back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h2 className="page-title">{children}</h2>
    </div>
  );
}
