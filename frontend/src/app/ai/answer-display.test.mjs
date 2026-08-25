import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  formatSelectedResponseQuestion,
  MAX_SELECTED_RESPONSE_EXCERPT_LENGTH,
  parseSelectedResponseQuestion,
  parseThinkingAndAnswer,
  removeLegacyEvidenceUsed,
} from "./answer-display.ts";

test("makes a selected response the primary reference for the next request", () => {
  assert.equal(
    formatSelectedResponseQuestion("Translate this to Thai.", "Use InBody export first."),
    "Selected response (primary reference):\n\nUse InBody export first.\n\nUser instruction:\n\nTranslate this to Thai.",
  );
  assert.match(
    formatSelectedResponseQuestion("", "Use this."),
    /Respond directly to the selected response/,
  );
  assert.equal(
    formatSelectedResponseQuestion("Keep this short.", "x".repeat(MAX_SELECTED_RESPONSE_EXCERPT_LENGTH + 1)).length,
    "Selected response (primary reference):\n\n\n\nUser instruction:\n\nKeep this short.".length + MAX_SELECTED_RESPONSE_EXCERPT_LENGTH,
  );
});

test("parses selected-response messages for clean chat rendering", () => {
  assert.deepEqual(
    parseSelectedResponseQuestion(
      formatSelectedResponseQuestion("Make it shorter.", "Start with InBody export."),
    ),
    { excerpt: "Start with InBody export.", instruction: "Make it shorter." },
  );
  assert.equal(parseSelectedResponseQuestion("Normal message"), null);
});

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
