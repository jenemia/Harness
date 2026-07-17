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

test("scheduler reasons shown by the dashboard and run result are localized", () => {
  assert.equal(
    localizeServerText("Project has reached its parallel run limit.", "ko"),
    "프로젝트가 병렬 실행 제한에 도달했습니다.",
  );
  assert.equal(
    localizeServerText(
      "Review backlog limit reached (2 cards / 145 unreviewed lines).",
      "ko",
    ),
    "검토 백로그 제한에 도달했습니다(카드 2개 / 미검토 변경 145줄).",
  );
  assert.equal(
    localizeServerText("Waiting on dependencies: API (Selected), deadbeef (missing)", "ko"),
    "의존 일감을 기다리는 중: API (선택됨), deadbeef (없음)",
  );
});

test("common activity messages are localized", () => {
  assert.equal(
    localizeServerText("Project memory was updated.", "ko"),
    "프로젝트 메모리를 수정했습니다.",
  );
  assert.equal(
    localizeServerText("human commented on this task.", "ko"),
    "사용자가 이 일감에 댓글을 남겼습니다.",
  );
  assert.equal(
    localizeServerText("Release notes was added to project memory.", "ko"),
    "Release notes을(를) 프로젝트 메모리에 추가했습니다.",
  );
});
