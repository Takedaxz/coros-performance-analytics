"use client";

import { useRef } from "react";

interface FileUploadProps {
  id: string;
  value: File | null;
  accept: string;
  helper: string;
  buttonLabel: string;
  iconOnly?: boolean;
  onChange: (file: File | null) => void;
}

export default function FileUpload({ id, value, accept, helper, buttonLabel, iconOnly = false, onChange }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function selectFile(file: File | undefined) {
    if (file) onChange(file);
  }

  return (
    <div className={`file-upload${iconOnly ? " is-icon" : ""}`}>
      <input
        ref={inputRef}
        id={id}
        className="file-upload-input"
        type="file"
        accept={accept}
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <button className="btn btn-secondary file-upload-button" type="button" aria-label={buttonLabel} title={buttonLabel} onClick={() => inputRef.current?.click()}>
        {iconOnly ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
          </svg>
        ) : value ? "Replace file" : buttonLabel}
      </button>
      {!iconOnly && value && <span className="file-upload-name" title={value.name}>{value.name}</span>}
      {!iconOnly && <span className="file-upload-helper">{helper}</span>}
    </div>
  );
}
