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
    if (!/(완료|검증|acceptance|done|complete|test)/i.test(content)) {
      result.push({ kind: "question", body: "완료 여부를 판단할 수 있도록 검증 방법과 명시적인 완료 조건을 추가해 주세요." });
    }
    if (!/(범위|scope|의존|depend|담당|owner|role)/i.test(content)) {
      result.push({ kind: "suggestion", body: "작업 범위, 제외 범위, 의존성, 담당 역할을 구분하면 실행 계획이 더 명확해집니다." });
    }
    if (latestReply) {
      result.push({ kind: "suggestion", body: `사용자 답변을 다음 revision의 요구사항에 반영해 주세요: ${latestReply.body.slice(0, 240)}` });
    }
    return result.length ? result : [{ kind: "suggestion", body: `최신 계획안\n\n${content.trim()}\n\n완료 조건과 주요 의존성을 최종 확인했습니다.` }];
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
