import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { parseThinkingAndAnswer, removeLegacyEvidenceUsed } from "./answer-display.ts";

test("removes legacy evidence paragraphs without hiding the coaching answer", () => {
  assert.equal(
    removeLegacyEvidenceUsed("Run easy tomorrow.\n\nEvidence used: HRV, sleep, and recent load."),
    "Run easy tomorrow.",
  );
});

test("preserves a Markdown boundary after streamed thinking", () => {
  const parsed = parseThinkingAndAnswer(
    "I’ll pull the upcoming week’s sessions.<think>Checking the calendar.</think># Weekly Briefing: 24–30 August 2026",
  );

  assert.equal(parsed.thinking, "Checking the calendar.");
  assert.equal(parsed.isThinkingActive, false);
  assert.equal(
    parsed.answer,
    "I’ll pull the upcoming week’s sessions.\n\n# Weekly Briefing: 24–30 August 2026",
  );
  assert.match(
    renderToStaticMarkup(React.createElement(ReactMarkdown, null, parsed.answer)),
    /<h1>Weekly Briefing: 24–30 August 2026<\/h1>/,
  );
});

test("moves streamed pre-tool text into active thinking without delaying it", () => {
  assert.deepEqual(
    parseThinkingAndAnswer("I’ll check the planned sessions first.<tool-thought>\n# Coach’s call"),
    {
      thinking: "I’ll check the planned sessions first.",
      answer: "# Coach’s call",
      isThinkingActive: false,
    },
  );
});

test("marks an empty think marker as active immediately", () => {
  assert.deepEqual(parseThinkingAndAnswer("<think>"), {
    thinking: null,
    answer: "",
    isThinkingActive: true,
  });
});
