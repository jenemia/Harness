import assert from "node:assert/strict";
import test from "node:test";
import { eventTypeLabel, localizeServerText } from "../src/i18n/serverText";

test("event types follow the selected locale", () => {
  assert.equal(eventTypeLabel("run.completed", "en"), "run.completed");
  assert.equal(eventTypeLabel("run.completed", "ko"), "실행 · 완료됨");
  assert.equal(eventTypeLabel("merge.changes_requested", "ko"), "병합 · 변경 요청");
});

test("known server messages are localized without changing dynamic values", () => {
  assert.equal(
    localizeServerText("Scheduler started 3 ready task(s).", "ko"),
    "스케줄러가 준비된 일감 3개를 시작했습니다.",
  );
  assert.equal(
    localizeServerText("feature/i18n preview is live.", "ko"),
    "feature/i18n 미리보기가 실행 중입니다.",
  );
  assert.equal(
    localizeServerText("Custom provider output", "ko"),
    "Custom provider output",
  );
  assert.equal(
    localizeServerText("Scheduler started 3 ready task(s).", "en"),
    "Scheduler started 3 ready task(s).",
  );
});
