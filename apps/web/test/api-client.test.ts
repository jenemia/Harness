import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorMessage, parseApiBody } from "../src/api/client.js";
import { requireAcceptedTaskStart, taskService } from "../src/services/taskService.js";

test("API errors expose a nested command rejection reason", () => {
  assert.equal(
    apiErrorMessage({ result: { accepted: false, reason: "Review backlog limit reached." } }),
    "Review backlog limit reached.",
  );
});

test("API errors prefer the server error field", () => {
  assert.equal(apiErrorMessage({ error: "Project not found." }), "Project not found.");
  assert.equal(apiErrorMessage({ result: { accepted: false } }), null);
});

test("API errors preserve plain text and tolerate empty response bodies", () => {
  assert.equal(apiErrorMessage(parseApiBody("Conflict while starting task")), "Conflict while starting task");
  assert.equal(parseApiBody("  "), null);
  assert.deepEqual(parseApiBody('{"ok":true}'), { ok: true });
});

test("desktop task starts reject the same structured reason as HTTP starts", () => {
  assert.throws(
    () => requireAcceptedTaskStart({ result: { accepted: false, reason: "Review backlog limit reached." } }),
    /Review backlog limit reached/,
  );
  assert.deepEqual(
    requireAcceptedTaskStart({ result: { accepted: true } }),
    { result: { accepted: true } },
  );
});

test("task service applies structured rejection handling to the desktop bridge", async () => {
  const globals = globalThis as typeof globalThis & { window?: Window };
  const previousWindow = globals.window;
  globals.window = {
    harness: {
      version: 1,
      invoke: async () => ({ result: { accepted: false, reason: "Assigned agent is unavailable." } }),
      subscribe: () => () => undefined,
    },
  } as unknown as Window;
  try {
    await assert.rejects(taskService.start("project", "task"), /Assigned agent is unavailable/);
  } finally {
    if (previousWindow) globals.window = previousWindow;
    else delete globals.window;
  }
});
