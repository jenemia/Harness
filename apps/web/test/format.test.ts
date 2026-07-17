import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration } from "../src/shared/format.js";

test("formatDuration shows the elapsed time for a completed sequential goal", () => {
  assert.equal(formatDuration("2026-07-12T01:00:00.000Z", "2026-07-12T02:02:03.000Z", "ko"), "1시간 2분 3초");
  assert.equal(formatDuration("2026-07-12T01:00:00.000Z", "2026-07-12T01:00:09.000Z", "en"), "9s");
});
