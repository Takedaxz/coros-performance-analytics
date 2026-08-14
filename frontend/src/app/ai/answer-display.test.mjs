import assert from "node:assert/strict";
import test from "node:test";
import { removeLegacyEvidenceUsed } from "./answer-display.ts";

test("removes legacy evidence paragraphs without hiding the coaching answer", () => {
  assert.equal(
    removeLegacyEvidenceUsed("Run easy tomorrow.\n\nEvidence used: HRV, sleep, and recent load."),
    "Run easy tomorrow.",
  );
});
