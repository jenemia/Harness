import assert from "node:assert/strict";
import test from "node:test";
import { eventTypeLabel, localizeServerText, serverTokenLabel } from "../src/i18n/serverText";

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

test("approval decisions and merge approval reasons are localized", () => {
  assert.equal(
    localizeServerText("Human approved merging this task into the main checkout.", "ko"),
    "사용자가 이 일감을 기본 체크아웃에 병합하도록 승인했습니다.",
  );
  assert.equal(
    localizeServerText("Human rejected command execution for this task.", "ko"),
    "사용자가 이 일감의 명령 실행을 거절했습니다.",
  );
  assert.equal(
    localizeServerText("Human requested changes before merging this task.", "ko"),
    "사용자가 이 일감을 병합하기 전에 변경을 요청했습니다.",
  );
  assert.equal(
    localizeServerText("Programmer Agent's task changes need approval before merging.", "ko"),
    "Programmer Agent의 일감 변경 사항을 병합하려면 승인이 필요합니다.",
  );
  assert.equal(
    localizeServerText("Human approved the PM handoff decision.", "en"),
    "Human approved the PM handoff decision.",
  );
});

test("workspace protection activity is localized", () => {
  assert.equal(eventTypeLabel("workspace.warn", "ko"), "작업 공간 · 경고");
  assert.equal(eventTypeLabel("workspace.block", "ko"), "작업 공간 · 차단");
  assert.equal(
    eventTypeLabel("workspace.exception.used", "ko"),
    "작업 공간 · 예외 · 사용됨",
  );
  assert.equal(
    localizeServerText(
      "WARN workspace policy: Write tool apply_patch targets a path outside the task workspace.",
      "ko",
    ),
    "경고 작업 공간 정책: 쓰기 도구 apply_patch이(가) 일감 작업 공간 밖의 경로를 대상으로 합니다.",
  );
  assert.equal(
    localizeServerText(
      "Approved one-run workspace exception used: Direct git push must be approved by Harness.",
      "ko",
    ),
    "승인된 일회성 작업 공간 예외를 사용했습니다: 직접 git push를 실행하려면 Harness의 승인이 필요합니다.",
  );
});

test("handoff reasons shown in task details are localized", () => {
  assert.equal(
    localizeServerText("Advanced to the next sequential goal.", "ko"),
    "다음 순차 목표로 이동했습니다.",
  );
  assert.equal(
    localizeServerText("The next goal has no assigned agent.", "ko"),
    "다음 목표에 배정된 에이전트가 없습니다.",
  );
  assert.equal(
    localizeServerText(
      "PM handoff to Review Agent needs approval because signals were detected: risk, error-mentioned.",
      "ko",
    ),
    "PM이 Review Agent(으)로 인계하려면 다음 신호가 감지되어 승인이 필요합니다: 위험, 오류 언급.",
  );
  assert.equal(
    localizeServerText(
      "PM handoff rule needs a reviewer agent, but none is available.",
      "ko",
    ),
    "PM 인계 규칙에는 검토자 에이전트가 필요하지만 사용 가능한 에이전트가 없습니다.",
  );
  assert.equal(
    localizeServerText(
      "PM dynamic handoff selected reviewer, but no matching agent is available.",
      "ko",
    ),
    "PM 동적 인계에서 검토자 역할을 선택했지만 일치하는 에이전트가 없습니다.",
  );
  assert.equal(
    localizeServerText(
      "PM auto-handoff rule: programmer -> reviewer. PM evaluated Programmer Agent's completion output. 2 changed file(s). Signals: risk, follow-up.",
      "ko",
    ),
    "PM 자동 인계 규칙: 프로그래머 → 검토자. PM이 Programmer Agent의 완료 출력을 평가했습니다. 변경된 파일 2개. 감지된 신호: 위험, 후속 작업.",
  );
  assert.equal(
    localizeServerText(
      "PM dynamic handoff: programmer -> reviewer. PM evaluated Programmer Agent's completion output. No changed files recorded. No follow-up signals detected.",
      "ko",
    ),
    "PM 동적 인계: 프로그래머 → 검토자. PM이 Programmer Agent의 완료 출력을 평가했습니다. 변경된 파일이 기록되지 않았습니다. 후속 신호가 감지되지 않았습니다.",
  );
  assert.equal(
    localizeServerText(
      "PM approved handoff. Human approved the PM handoff decision.",
      "ko",
    ),
    "PM이 인계를 승인했습니다. 사용자가 PM의 인계 결정을 승인했습니다.",
  );
  assert.equal(serverTokenLabel("error-mentioned", "ko"), "오류 언급");
  assert.equal(serverTokenLabel("reviewer", "en"), "reviewer");
});
