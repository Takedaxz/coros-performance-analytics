# Race documents

## Goal

Let the single COROS owner keep ticket and order-confirmation images or PDFs
in a local document vault, optionally attached to one training goal/race.

## Scope

- Accept image and PDF uploads up to 20 MB.
- Store files on the COROS server and document metadata in PostgreSQL.
- List all documents, with optional filtering/association by goal.
- Permit the owner to upload, download, and delete documents.
- Keep documents when a goal is deleted; only remove the goal association.

## Non-goals

- Cloud sync or external storage providers.
- OCR, AI extraction, sharing, or multi-user collaboration.

## Design

Add one `documents` table. Each row has an owner ID, optional `goal_id`, the
original filename, MIME type, byte size, generated storage filename, and upload
timestamp. Files live below the configured local storage directory. APIs verify
the owner and allowed file type before writing, serving, or deleting a file.

The Settings page gains a Documents section for the vault and each goal shows
its attached documents. Deleting a goal clears `goal_id` rather than deleting
documents.

## Reliability and security

- Write the upload to a temporary file before recording metadata.
- Generate storage filenames; never trust an uploaded filename as a path.
- Restrict every document operation to the configured owner.
- Reject disallowed types and files over 20 MB.
- Allow deletion to finish if the physical file was already removed.

## Verification

Focused API tests cover valid upload, invalid type/size, owner access,
goal-deletion preservation, and deletion. Frontend checks cover TypeScript,
lint, and a browser smoke test of upload, open, and delete.

## Decision log

| Decision | Alternatives | Reason |
| --- | --- | --- |
| Local storage | Cloud storage | Requested private, self-hosted storage. |
| One document table | Goal JSON or folders only | Supports a vault and optional goal link cleanly. |
| Preserve documents after deleting a goal | Cascade delete | Prevents accidental loss of tickets and confirmations. |
