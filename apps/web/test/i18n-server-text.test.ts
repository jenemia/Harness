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
    localizeServerText("Task is already running.", "ko"),
    "일감이 이미 실행 중입니다.",
  );
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
  assert.equal(
    localizeServerText("Agent is disabled in its agent.md definition.", "ko"),
    "agent.md 정의에서 에이전트가 비활성화되어 있습니다.",
  );
  assert.equal(
    localizeServerText("Agent definition has not been materialized yet.", "ko"),
    "에이전트 정의 파일이 아직 생성되지 않았습니다.",
  );
  assert.equal(
    localizeServerText("Agent definition is invalid: Fix agent.md before starting a new run.", "ko"),
    "에이전트 정의가 유효하지 않습니다: 새 실행을 시작하기 전에 agent.md를 수정하세요.",
  );
  assert.equal(
    localizeServerText(
      "Programmer Agent needs approval before running Codex. Risky command policy requires approval before running: recursive forced delete, Git push.",
      "ko",
    ),
    "Programmer Agent이(가) Codex을(를) 실행하려면 승인이 필요합니다. 위험 명령 정책에 따라 다음 항목은 실행 전 승인이 필요합니다: 재귀 강제 삭제, Git 푸시.",
  );
  assert.equal(
    localizeServerText(
      "Programmer Agent is not allowed to run Codex. Add one of these allowed tools: shell, llm-cli, codex.",
      "ko",
    ),
    "Programmer Agent은(는) Codex을(를) 실행할 수 없습니다. 다음 허용 도구 중 하나를 추가하세요: shell, llm-cli, codex.",
  );
  assert.equal(
    localizeServerText("Command execution approval was rejected.", "ko"),
    "명령 실행 승인이 거절되었습니다.",
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
  assert.equal(
    localizeServerText("Programmer Agent Markdown was saved.", "ko"),
    "Programmer Agent Markdown을 저장했습니다.",
  );
  assert.equal(
    localizeServerText("Software Team project template created 3 agent(s).", "ko"),
    "Software Team 프로젝트 템플릿으로 에이전트 3개를 생성했습니다.",
  );
  assert.equal(
    localizeServerText("local-admin called save_agent as dry-run.", "ko"),
    "local-admin이(가) save_agent 도구를 시험 실행으로 호출했습니다.",
  );
  assert.equal(
    localizeServerText("local-admin called get_task.", "ko"),
    "local-admin이(가) get_task 도구를 호출했습니다.",
  );
  assert.equal(eventTypeLabel("project.template.applied", "ko"), "프로젝트 · 템플릿 · 적용됨");
  assert.equal(eventTypeLabel("mcp.tool.succeeded", "ko"), "MCP · 도구 · 성공");
});
