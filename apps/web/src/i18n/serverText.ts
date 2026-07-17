import type { SupportedLocale } from "./messages";

const koreanEventTerms: Record<string, string> = {
  agent: "에이전트",
  approval: "승인",
  approved: "승인됨",
  applied: "적용됨",
  archived: "보관됨",
  automatic: "자동",
  blocked: "차단됨",
  changes_requested: "변경 요청",
  cloned: "복제됨",
  comment: "댓글",
  complete: "완료",
  completed: "완료됨",
  completion: "완료",
  conflict: "충돌",
  crashed: "비정상 종료",
  created: "생성됨",
  decomposed: "분할됨",
  development: "개발",
  document: "문서",
  evaluated: "평가됨",
  expired: "만료됨",
  failed: "실패",
  file: "파일",
  followup: "후속 일감",
  followups: "후속 일감",
  handoff: "인계",
  initialized: "초기화됨",
  interaction: "상호작용",
  interrupted: "중단됨",
  live: "실행 중",
  memory: "메모리",
  merge: "병합",
  mcp: "MCP",
  pending: "대기 중",
  plan: "계획",
  pm: "PM",
  policy: "정책",
  preview: "미리보기",
  project: "프로젝트",
  queued: "대기열 등록",
  raw: "원본",
  recovered: "복구됨",
  registered: "등록됨",
  rejected: "거절됨",
  removed: "삭제됨",
  reordered: "순서 변경됨",
  report: "보고서",
  requested: "요청됨",
  resolved: "해결됨",
  resumed: "재개됨",
  review: "검토",
  risk_detected: "위험 감지",
  run: "실행",
  runtime: "런타임",
  saved: "저장됨",
  scheduler: "스케줄러",
  seeded: "기본 구성됨",
  skipped: "건너뜀",
  started: "시작됨",
  stopped: "중지됨",
  succeeded: "성공",
  suspended: "일시 중단됨",
  task: "일감",
  template: "템플릿",
  tool: "도구",
  unblocked: "차단 해제됨",
  updated: "수정됨",
  workspace: "작업 공간",
};

const exactKoreanText: Record<string, string> = {
  "Agent definition has not been materialized yet.":
    "에이전트 정의 파일이 아직 생성되지 않았습니다.",
  "Agent is disabled in its agent.md definition.":
    "agent.md 정의에서 에이전트가 비활성화되어 있습니다.",
  "Agent instruction files changed.": "에이전트 지침 파일이 변경되었습니다.",
  "Agent run failed.": "에이전트 실행이 실패했습니다.",
  "Completion report generation failed; the run result remains valid.":
    "완료 보고서를 생성하지 못했지만 실행 결과는 유효합니다.",
  "Default PM, programmer, and review agents were created.":
    "기본 PM, 프로그래머, 리뷰 에이전트를 생성했습니다.",
  "Document was updated.": "문서를 수정했습니다.",
  "Harness could not finalize the merge resolution.":
    "Harness가 병합 충돌 해결을 완료하지 못했습니다.",
  "Harness initialized the project Git repository with a baseline commit.":
    "Harness가 기준 커밋으로 프로젝트 Git 저장소를 초기화했습니다.",
  "Harness reset this interrupted task so it can be run again.":
    "중단된 일감을 다시 실행할 수 있도록 Harness가 초기화했습니다.",
  "Interaction expired before the response was accepted.":
    "응답을 수락하기 전에 상호작용이 만료되었습니다.",
  "Interaction expired while Harness was offline.":
    "Harness가 오프라인인 동안 상호작용이 만료되었습니다.",
  "Interaction response was accepted.": "상호작용 응답을 수락했습니다.",
  "Interaction was rejected by the user.": "사용자가 상호작용을 거절했습니다.",
  "Matching follow-up goals already exist.": "일치하는 후속 목표가 이미 있습니다.",
  "Memory was updated.": "프로젝트 메모리를 수정했습니다.",
  "Project memory was updated.": "프로젝트 메모리를 수정했습니다.",
  "Merge approval hit a conflict. Resolve conflicts in the main checkout, then finalize the merge.":
    "병합 승인 중 충돌이 발생했습니다. 기본 체크아웃에서 충돌을 해결한 뒤 병합을 완료하세요.",
  "No available agent could be selected for this task.":
    "이 일감에 배정할 수 있는 에이전트가 없습니다.",
  "PM Agent marked development complete; human confirmation is required.":
    "PM 에이전트가 개발 완료로 표시했습니다. 사용자의 확인이 필요합니다.",
  "PM skipped automatic follow-up creation because matching goals already exist.":
    "일치하는 목표가 이미 있어 PM이 자동 후속 일감 생성을 건너뛰었습니다.",
  "Risky command policy requires approval.": "위험 명령 정책에 따라 승인이 필요합니다.",
  "Assigned agent is missing.": "배정된 에이전트를 찾을 수 없습니다.",
  "Assigned agent has reached its parallel run limit.":
    "배정된 에이전트가 병렬 실행 제한에 도달했습니다.",
  "No agent has available execution capacity.":
    "실행 가능한 여유가 있는 에이전트가 없습니다.",
  "No worker agents are available for scheduling.":
    "스케줄링 가능한 작업 에이전트가 없습니다.",
  "Project has reached its parallel run limit.":
    "프로젝트가 병렬 실행 제한에 도달했습니다.",
  "Command execution approval was rejected.": "명령 실행 승인이 거절되었습니다.",
  "Task is already running.": "일감이 이미 실행 중입니다.",
  "Task changes are waiting for human merge approval.":
    "일감 변경 사항이 사용자의 병합 승인을 기다리고 있습니다.",
  "Task was returned to the backlog for PM reassignment.":
    "PM이 다시 배정할 수 있도록 일감을 백로그로 돌려보냈습니다.",
  "Task was updated.": "일감을 수정했습니다.",
  "All dependencies are complete. PM Agent queued this task for execution.":
    "모든 의존 일감이 완료되어 PM 에이전트가 이 일감을 실행 대기열에 등록했습니다.",
};

function koreanTerm(value: string) {
  return koreanEventTerms[value] || value;
}

function koreanActorSubject(value: string) {
  return value.toLowerCase() === "human" ? "사용자가" : `${value}이(가)`;
}

function koreanDependencyItems(value: string) {
  return value
    .replace(/ \(missing\)/g, " (없음)")
    .replace(/ \((Backlog|Selected|Running|Review|Done|Blocked|Paused)\)/g, (_match, status: string) => {
      const statuses: Record<string, string> = {
        Backlog: "백로그",
        Selected: "선택됨",
        Running: "실행 중",
        Review: "검토",
        Done: "완료",
        Blocked: "차단됨",
        Paused: "일시 중지됨",
      };
      return ` (${statuses[status]})`;
    });
}

function koreanAgentDefinitionError(value: string) {
  return value === "Fix agent.md before starting a new run."
    ? "새 실행을 시작하기 전에 agent.md를 수정하세요."
    : value;
}

function koreanRiskItems(value: string) {
  const risks: Record<string, string> = {
    "recursive forced delete": "재귀 강제 삭제",
    "hard Git reset": "Git 강제 초기화",
    "Git clean": "Git 정리",
    "Git push": "Git 푸시",
    "Git merge or rebase": "Git 병합 또는 리베이스",
    sudo: "sudo 권한 상승",
    "package install or update": "패키지 설치 또는 업데이트",
    "remote script piped to shell": "원격 스크립트의 셸 전달 실행",
  };
  return value
    .split(", ")
    .map((risk) => risks[risk] || risk)
    .join(", ");
}

const koreanPatterns: Array<[RegExp, (...values: string[]) => string]> = [
  [/^Review backlog limit reached \((\d+) cards \/ (\d+) unreviewed lines\)\.$/, (cards, lines) => `검토 백로그 제한에 도달했습니다(카드 ${cards}개 / 미검토 변경 ${lines}줄).`],
  [/^Waiting on dependencies: (.+)$/, (items) => `의존 일감을 기다리는 중: ${koreanDependencyItems(items)}`],
  [/^Agent definition is invalid: (.+)$/, (error) => `에이전트 정의가 유효하지 않습니다: ${koreanAgentDefinitionError(error)}`],
  [/^(.+) is not allowed to run (.+)\. Add one of these allowed tools: (.+)\.$/, (agent, provider, tools) => `${agent}은(는) ${provider}을(를) 실행할 수 없습니다. 다음 허용 도구 중 하나를 추가하세요: ${tools}.`],
  [/^(.+) needs approval before running (.+)\. Risky command policy requires approval before running: (.+)\.$/, (agent, provider, risks) => `${agent}이(가) ${provider}을(를) 실행하려면 승인이 필요합니다. 위험 명령 정책에 따라 다음 항목은 실행 전 승인이 필요합니다: ${koreanRiskItems(risks)}.`],
  [/^(.+) needs approval before running (.+)\.$/, (agent, provider) => `${agent}이(가) ${provider}을(를) 실행하려면 승인이 필요합니다.`],
  [/^Risky command policy requires approval before running: (.+)\.$/, (risks) => `위험 명령 정책에 따라 다음 항목은 실행 전 승인이 필요합니다: ${koreanRiskItems(risks)}.`],
  [/^(.+) commented on this task\.$/, (author) => `${koreanActorSubject(author)} 이 일감에 댓글을 남겼습니다.`],
  [/^(.+) was added to project memory\.$/, (title) => `${title}을(를) 프로젝트 메모리에 추가했습니다.`],
  [/^(.+) was created\.$/, (name) => `${name}을(를) 생성했습니다.`],
  [/^(.+) was updated\.$/, (name) => `${name}을(를) 수정했습니다.`],
  [/^(.+) was archived\.$/, (name) => `${name}을(를) 보관 처리했습니다.`],
  [/^(.+) was cloned\.$/, (name) => `${name}을(를) 복제했습니다.`],
  [/^(.+) Markdown was saved\.$/, (name) => `${name} Markdown을 저장했습니다.`],
  [/^(.+) project template created (\d+) agent\(s\)\.$/, (name, count) => `${name} 프로젝트 템플릿으로 에이전트 ${count}개를 생성했습니다.`],
  [/^(.+) called (.+) as dry-run\.$/, (client, tool) => `${client}이(가) ${tool} 도구를 시험 실행으로 호출했습니다.`],
  [/^(.+) called (.+)\.$/, (client, tool) => `${client}이(가) ${tool} 도구를 호출했습니다.`],
  [/^(.+) preview is booting\.$/, (label) => `${label} 미리보기를 시작하는 중입니다.`],
  [/^(.+) preview is live\.$/, (label) => `${label} 미리보기가 실행 중입니다.`],
  [/^(.+) preview was stopped\.$/, (label) => `${label} 미리보기를 중지했습니다.`],
  [/^(.+) preview crashed\.$/, (label) => `${label} 미리보기가 비정상 종료되었습니다.`],
  [/^(.+) preview was explicitly registered\.$/, (label) => `${label} 미리보기를 명시적으로 등록했습니다.`],
  [/^(.+) preview registration was removed\.$/, (label) => `${label} 미리보기 등록을 삭제했습니다.`],
  [/^(.+) orphan preview was stopped during recovery\.$/, (label) => `복구 중 ${label}의 연결이 끊긴 미리보기를 중지했습니다.`],
  [/^(.+) artifact is available\.$/, (label) => `${label} 결과물을 사용할 수 있습니다.`],
  [/^Interaction was (.+)\.$/, (status) => `상호작용이 ${koreanTerm(status)} 상태로 변경되었습니다.`],
  [/^Approval interaction was (.+)\.$/, (status) => `승인 상호작용이 ${koreanTerm(status)} 상태로 변경되었습니다.`],
  [/^Scheduler started (\d+) ready task\(s\)\.$/, (count) => `스케줄러가 준비된 일감 ${count}개를 시작했습니다.`],
  [/^(.+) completed the run\.$/, (agent) => `${agent}이(가) 실행을 완료했습니다.`],
  [/^Merged (.+) into the main project checkout\.$/, (branch) => `${branch} 브랜치를 기본 프로젝트 체크아웃에 병합했습니다.`],
  [/^Resolved merge conflicts and finalized (.+)\.$/, (branch) => `병합 충돌을 해결하고 ${branch} 브랜치를 완료했습니다.`],
  [/^(.+) started work in (.+)\.$/, (agent, path) => `${agent}이(가) ${path}에서 작업을 시작했습니다.`],
  [/^(.+) resumed work from interaction (.+)\.$/, (agent, interaction) => `${agent}이(가) 상호작용 ${interaction}부터 작업을 재개했습니다.`],
  [/^Task handed from (.+) to (.+)\.$/, (from, to) => `일감을 ${from}에서 ${to}(으)로 인계했습니다.`],
  [/^PM Agent handed the task from (.+) to (.+)\.$/, (from, to) => `PM 에이전트가 일감을 ${from}에서 ${to}(으)로 인계했습니다.`],
  [/^(\d+) follow-up goal\(s\) were added\.$/, (count) => `후속 목표 ${count}개를 추가했습니다.`],
  [/^Completion report revision (\d+) recorded (\d+) changed file\(s\)\.$/, (revision, files) => `완료 보고서 개정 ${revision}에 변경 파일 ${files}개를 기록했습니다.`],
  [/^(.+) marked (unreviewed|reviewed)\.$/, (path, status) => `${path}을(를) ${status === "reviewed" ? "검토됨" : "미검토"}으로 표시했습니다.`],
  [/^Inline review comment added to (.+):(\d+)\.$/, (path, line) => `${path}:${line}에 인라인 검토 댓글을 추가했습니다.`],
  [/^Inline review comment marked (.+)\.$/, (status) => `인라인 검토 댓글을 ${koreanTerm(status)} 상태로 변경했습니다.`],
  [/^Added review follow-up goal to (.+)\.$/, (title) => `${title}에 검토 후속 목표를 추가했습니다.`],
  [/^PM Agent decomposed a goal into (\d+) tasks\.$/, (count) => `PM 에이전트가 목표를 일감 ${count}개로 분할했습니다.`],
  [/^(.+) was created by PM planning\.$/, (title) => `PM 계획에서 ${title} 일감을 생성했습니다.`],
  [/^(\d+) sequential goal\(s\) were added to (.+)\.$/, (count, title) => `${title}에 순차 목표 ${count}개를 추가했습니다.`],
  [/^Recovered (\d+) interrupted run\(s\), (\d+) task\(s\), and (\d+) agent\(s\)\.$/, (runs, tasks, agents) => `중단된 실행 ${runs}개, 일감 ${tasks}개, 에이전트 ${agents}개를 복구했습니다.`],
  [/^Task moved (.+) in (.+)\.$/, (direction, status) => `${koreanTerm(status)}에서 일감을 ${direction === "up" ? "위" : direction === "down" ? "아래" : direction}(으)로 이동했습니다.`],
  [/^PM added (\d+) follow-up goal\(s\) from completion output\.$/, (count) => `PM이 완료 출력에서 후속 목표 ${count}개를 추가했습니다.`],
];

export function eventTypeLabel(type: string, locale: SupportedLocale) {
  if (locale !== "ko") return type;
  return type
    .split(/[.-]/)
    .map(koreanTerm)
    .join(" · ");
}

export function localizeServerText(text: string, locale: SupportedLocale) {
  if (locale !== "ko" || !text) return text;
  const exact = exactKoreanText[text];
  if (exact) return exact;
  for (const [pattern, format] of koreanPatterns) {
    const match = text.match(pattern);
    if (match) return format(...match.slice(1));
  }
  return text;
}
