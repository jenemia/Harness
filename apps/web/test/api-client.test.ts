import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorMessage } from "../src/api/client.js";

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
