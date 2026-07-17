import assert from "node:assert/strict";
import test from "node:test";
import { detectCompletionSignals, implementationCommitMessage, parseAutomaticFollowUpCandidates } from "../src/runtime.js";
import { codexCommand } from "../src/providers.js";

test("Codex commands pipe prompt file contents with workspace write access", () => {
  assert.equal(
    codexCommand("gpt-5.6-codex-sol"),
    'codex exec --model gpt-5.6-codex-sol --sandbox workspace-write - < "$HARNESS_PROMPT_FILE"',
  );
});

test("implementation commits carry full task and run provenance without provider session identifiers", () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const message = implementationCommitMessage({ id: taskId, title: "Implement review queue" }, runId);
  assert.equal(message, `Harness task 11111111: Implement review queue\n\nHarness-Task: ${taskId}\nHarness-Run: ${runId}`);
  assert.doesNotMatch(message, /Session/i);
});

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
