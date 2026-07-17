import assert from "node:assert/strict";
import test from "node:test";
import { detectCompletionSignals, parseAutomaticFollowUpCandidates } from "../src/runtime.js";

test("automatic follow-ups require an explicit follow-up prefix", () => {
  const output = [
    "The task needs write access before implementation can continue.",
    "No file changes to commit.",
    "<style global>body{font-family:Arial}</style>",
  ].join("\n");

  assert.deepEqual(parseAutomaticFollowUpCandidates(output, "Localization"), []);
  assert.equal(detectCompletionSignals(output, []).includes("follow-up"), false);
});

test("automatic follow-ups preserve explicitly labelled action items", () => {
  const output = [
    "Follow-up: Add the missing activity status translations",
    "- TODO: Verify the Korean dashboard labels",
    "Next step: Document the locale fallback behavior",
  ].join("\n");

  assert.deepEqual(
    parseAutomaticFollowUpCandidates(output, "Localization").map((item) => item.title),
    [
      "Add the missing activity status translations",
      "Verify the Korean dashboard labels",
      "Document the locale fallback behavior",
    ],
  );
  assert.equal(detectCompletionSignals(output, ["apps/web/src/i18n/messages.ts"]).includes("follow-up"), true);
});
