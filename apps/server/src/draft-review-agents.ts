import {
  cancelDraftReviewRequest,
  claimDraftReviewRequest,
  failDraftReviewRequest,
  getDraftSnapshot,
  recordDraftReviewProgress,
  registerDraftReviewRuntime,
  retryDraftReviewRequest,
  submitDraftReview
} from "./drafts.js";
import type { DraftCommentRecord, DraftReviewRequestRecord, DraftReviewerRecord, ProjectRecord } from "./types.js";

const running = new Map<string, { draftId: string; controller: AbortController }>();
let registered = false;

export function ensureDraftReviewAgentRuntime() {
  if (registered) return;
  registered = true;
  registerDraftReviewRuntime({
    start(project, request) {
      startDraftReview(project, request);
    },
    cancel(_project, draftId) {
      for (const state of running.values()) {
        if (state.draftId === draftId) state.controller.abort();
      }
    }
  });
}

export function stopDraftReview(project: ProjectRecord, requestId: string) {
  running.get(requestId)?.controller.abort();
  return cancelDraftReviewRequest(project, requestId);
}

export function retryDraftReview(project: ProjectRecord, requestId: string) {
  return retryDraftReviewRequest(project, requestId);
}

function startDraftReview(project: ProjectRecord, request: DraftReviewRequestRecord) {
  if (running.has(request.id)) return;
  const controller = new AbortController();
  running.set(request.id, { draftId: request.draftId, controller });
  queueMicrotask(() => {
    void runDraftReview(project, request, controller.signal).finally(() => running.delete(request.id));
  });
}

async function runDraftReview(project: ProjectRecord, request: DraftReviewRequestRecord, signal: AbortSignal) {
  try {
    const claimed = claimDraftReviewRequest(project, request.id);
    if (claimed.status !== "running") return;
    recordDraftReviewProgress(project, request.id, "Reading the current draft revision and unresolved discussion.");
    await abortableDelay(120, signal);
    const snapshot = getDraftSnapshot(project, request.draftId);
    const reviewer = snapshot.reviewers.find((item) => item.id === request.reviewerId);
    const revision = snapshot.revisions.find((item) => item.revision === request.revision);
    if (!reviewer || !revision) throw new Error("Draft reviewer context is unavailable.");
    recordDraftReviewProgress(project, request.id, "Checking scope, completion criteria, dependencies, and failure modes.");
    await abortableDelay(120, signal);
    const existingBodies = new Set(snapshot.comments
      .filter((comment) => comment.reviewerId === reviewer.id)
      .map((comment) => comment.body.trim()));
    const comments = reviewDraft(reviewer, revision.content, snapshot.comments)
      .filter((comment) => !existingBodies.has(comment.body.trim()));
    if (signal.aborted) return;
    submitDraftReview(project, request.id, {
      comments: comments.map((comment, index) => ({
        ...comment,
        idempotencyKey: `${request.id}:${index}:${comment.kind}`
      }))
    });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
    failDraftReviewRequest(project, request.id, error instanceof Error ? error.message : String(error));
  }
}

function reviewDraft(
  reviewer: DraftReviewerRecord,
  content: string,
  comments: DraftCommentRecord[]
): Array<{ kind: "suggestion" | "question" | "risk"; body: string }> {
  const normalized = content.toLowerCase();
  const latestReply = [...comments]
    .reverse()
    .find((comment) => comment.kind === "reply" && comment.revision === reviewer.lastRequestedRevision);

  if (reviewer.role === "planning-reviewer" || reviewer.role === "planner") {
    const result: Array<{ kind: "suggestion" | "question" | "risk"; body: string }> = [];
    result.push({ kind: "suggestion", body: buildPlanningReview(content) });
    if (!/(완료|검증|acceptance|done|complete|test)/i.test(content)) {
      result.push({ kind: "question", body: "완료 판단을 위해 변경된 동작을 재현하는 검증 방법(자동 테스트·수동 확인)과 통과 기준을 정해 주세요." });
    }
    if (latestReply) {
      result.push({ kind: "suggestion", body: `사용자 답변을 다음 revision의 요구사항에 반영해 주세요: ${latestReply.body.slice(0, 240)}` });
    }
    return result;
  }

  const result: Array<{ kind: "suggestion" | "question" | "risk"; body: string }> = [];
  if (!/(실패|오류|예외|재시도|복구|failure|error|retry|rollback)/i.test(content)) {
    result.push({ kind: "risk", body: "실패·부분 성공·재시도·복구 시나리오가 빠져 있습니다. 데이터 일관성과 사용자 재시도 동작을 정의해 주세요." });
  }
  if (/(외부|api|인증|권한|파일|삭제|결제|external|auth|permission|delete|payment)/i.test(normalized)) {
    result.push({ kind: "risk", body: "외부 시스템, 인증·권한 또는 데이터 변경 경계가 보입니다. 승인 지점과 민감정보 처리 방식을 명시해 주세요." });
  }
  if (latestReply) {
    result.push({ kind: "question", body: `답변의 경계 조건도 확인해 주세요: ${latestReply.body.slice(0, 240)}` });
  }
  return result.length ? result : [{ kind: "question", body: "동시 실행, 취소, 중복 요청 중 어떤 경계 조건을 우선 검증해야 하나요?" }];
}

function buildPlanningReview(content: string) {
  const summary = content.replace(/\s+/g, " ").trim().slice(0, 180) || "현재 일감";
  const isReviewFlow = /(내용\s*검토|검토.*에이전트|planner|planning|review)/i.test(content);
  const hasExternalBoundary = /(외부|api|인증|권한|파일|삭제|결제|external|auth|permission|delete|payment)/i.test(content);
  const direction = isReviewFlow
    ? [
        "검토 결과를 만드는 planner 진입점과 일감 추가 화면의 표시 경로를 먼저 추적합니다.",
        "고정 체크리스트 문구를 `구현 방향`, `사이드 이펙트`, `보완할 명세`로 구성된 구조화된 검토 결과로 교체하고, 일감 본문의 대상·동작·제약을 각 항목에 반영합니다.",
        "기존 댓글 상태, 재검토, 최신 계획안 적용 흐름은 유지한 채 대표 일감으로 결과 형식과 중복 생성 방지를 검증합니다."
      ]
    : implementationDirection(content);
  const risks = [
    isReviewFlow
      ? "검토 문구의 형식이나 길이를 바꾸면 최신 계획안 적용, 댓글 중복 제거, UI 줄바꿈 표시가 깨질 수 있습니다. 기존 소비 경로와 이전 댓글을 함께 확인하세요."
      : "기존 호출자와 저장된 데이터가 새 동작을 전제로 하지 않을 수 있으므로, 입력 누락·이전 데이터·재시도 시의 호환성을 확인하세요.",
    hasExternalBoundary
      ? "외부 연동 또는 권한·데이터 변경이 포함되므로, 실패·타임아웃·부분 성공 시의 복구와 승인 경계를 정의해야 합니다."
      : "동시 요청, 취소, 재시도 또는 중복 실행 시 결과가 중복되거나 오래된 상태로 덮이지 않는지 확인하세요."
  ];
  const missing = [
    "원하는 결과의 예시와 우선순위(필수로 제안할 항목, 허용할 일반론의 범위)를 명시하세요.",
    "변경 대상과 제외 대상, 성공을 판정할 테스트 또는 수동 확인 절차를 추가하세요."
  ];

  return [
    `일감 분석: ${summary}`,
    "",
    "구현 방향",
    ...direction.map((item, index) => `${index + 1}. ${item}`),
    "",
    "사이드 이펙트 / 확인할 점",
    ...risks.map((item) => `- ${item}`),
    "",
    "보완할 내용",
    ...missing.map((item) => `- ${item}`)
  ].join("\n");
}

function implementationDirection(content: string) {
  const subject = content.replace(/\s+/g, " ").trim().slice(0, 120) || "요청한 기능";
  const directions: string[] = [
    `“${subject}”의 현재 진입점과 호출 흐름을 확인해 변경 대상 모듈과 기존 계약을 확정합니다.`
  ];
  if (/(ui|ux|화면|버튼|모달|폼|페이지|웹|frontend|front-end)/i.test(content)) {
    directions.push("UI 상태·입력 검증·로딩/오류 표시를 함께 설계하고, 기존 화면 흐름을 깨지 않도록 컴포넌트와 API 계약을 맞춥니다.");
  } else if (/(api|서버|backend|back-end|엔드포인트|db|데이터베이스|저장|migration)/i.test(content)) {
    directions.push("요청/응답 및 저장 모델의 변경을 먼저 정의한 뒤, 검증·권한·마이그레이션을 포함해 서버 경계를 구현합니다.");
  } else if (/(테스트|test|버그|오류|에러|fix|수정)/i.test(content)) {
    directions.push("문제를 재현하는 최소 사례를 먼저 고정하고, 원인 경로를 수정한 뒤 성공·실패·회귀 사례를 테스트에 추가합니다.");
  } else {
    directions.push("변경을 데이터/도메인 처리, 외부 인터페이스, 검증의 작은 단위로 나누고 각 단위의 입력과 출력을 명확히 합니다.");
  }
  directions.push("수정 전후의 대표 사용 흐름과 실패 경로를 자동 테스트 또는 재현 가능한 수동 절차로 검증합니다.");
  return directions;
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function abortError() {
  const error = new Error("Draft review was cancelled.");
  error.name = "AbortError";
  return error;
}
