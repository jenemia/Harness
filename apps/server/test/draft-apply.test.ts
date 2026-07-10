import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DraftRevisionConflictError,
  cancelDraftReviewTimers,
  claimDraftReviewRequest,
  createDraftReply,
  createDraftSession,
  decideDraftApply,
  getDraftSnapshot,
  recordDraftApplyAttempt,
  restoreDraftRevision,
  submitDraftReview,
  undoDraftApply,
  updateDraftCommentStatus,
  updateDraftRevision
} from "../src/drafts.js";
import { registerProjectService } from "../src/services.js";

test("draft apply proposes structured changes, requires approval, preserves questions, and supports undo and restore", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-draft-apply-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  const scheduling = { debounceMs: 0, rateLimitMs: 0, autoReview: false };
  let projectPath = "";
  let draftId = "";
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    projectPath = project.path;
    const original = "CSV 내보내기를 구현한다.\n완료 조건: 통합 테스트가 통과한다.";
    const created = createDraftSession(project, { content: original }, scheduling);
    draftId = created.session.id;
    const ready = await waitForDraft(project, draftId, (snapshot) =>
      snapshot.requests.filter((request) => request.revision === 1 && request.status === "pending").length === 2
    );
    const planningRequest = ready.requests.find((request) =>
      ready.reviewers.find((reviewer) => reviewer.id === request.reviewerId)?.role === "planning-reviewer"
    );
    const edgeRequest = ready.requests.find((request) =>
      ready.reviewers.find((reviewer) => reviewer.id === request.reviewerId)?.role === "edge-case-reviewer"
    );
    assert.ok(planningRequest && edgeRequest);
    claimDraftReviewRequest(project, planningRequest.id);
    const planning = submitDraftReview(project, planningRequest.id, {
      comments: [
        { kind: "suggestion", body: "의존성: 파일 저장소 adapter를 명시한다.", idempotencyKey: "dependency" },
        { kind: "question", body: "지원 형식은 무엇인가요?", idempotencyKey: "format" }
      ]
    });
    claimDraftReviewRequest(project, edgeRequest.id);
    const edge = submitDraftReview(project, edgeRequest.id, {
      comments: [
        { kind: "risk", body: "부분 파일 실패 시 임시 파일을 정리한다.", idempotencyKey: "cleanup" },
        { kind: "question", body: "동시 내보내기 제한은 몇 개인가요?", idempotencyKey: "concurrency" }
      ]
    });
    createDraftReply(project, draftId, {
      parentCommentId: planning.comments[1].id,
      body: "@planning-reviewer 첫 버전은 CSV만 지원합니다.",
      idempotencyKey: "format-answer"
    }, scheduling);

    const selectedCommentIds = [...planning.comments, ...edge.comments].map((comment) => comment.id);
    const proposal = recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 1,
      selectedCommentIds,
      idempotencyKey: "proposal-1"
    });
    assert.equal(proposal.status, "pending");
    assert.equal(getDraftSnapshot(project, draftId).session.currentRevision, 1, "requesting apply must not mutate the draft");
    assert.equal(proposal.result?.originalContent, original);
    assert.match(proposal.result?.proposedContent || "", /CSV만 지원/);
    assert.match(proposal.result?.unifiedDiff || "", /^--- draft\/original/m);
    assert.deepEqual(proposal.result?.dependencies, ["의존성: 파일 저장소 adapter를 명시한다."]);
    assert.deepEqual(proposal.result?.risks, ["부분 파일 실패 시 임시 파일을 정리한다."]);
    assert.deepEqual(proposal.result?.unresolvedQuestions, [{
      commentId: edge.comments[1].id,
      body: "동시 내보내기 제한은 몇 개인가요?"
    }]);
    assert.equal(recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 1,
      selectedCommentIds,
      idempotencyKey: "proposal-1"
    }).id, proposal.id, "the same idempotency key must return the original proposal");

    const rejected = recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 1,
      selectedCommentIds: [planning.comments[0].id],
      idempotencyKey: "proposal-cancel"
    });
    assert.equal(decideDraftApply(project, draftId, rejected.id, "rejected", scheduling).history.status, "rejected");
    assert.equal(getDraftSnapshot(project, draftId).session.currentRevision, 1);

    const approved = decideDraftApply(project, draftId, proposal.id, "approved", scheduling);
    assert.equal(approved.changed, true);
    assert.equal(approved.history.status, "applied");
    assert.equal(approved.snapshot.session.currentRevision, 2);
    assert.equal(approved.snapshot.revisions.at(-1)?.content, proposal.result?.proposedContent);
    assert.ok(approved.snapshot.comments.some((comment) =>
      comment.revision === 2 && comment.kind === "question" && comment.status === "open" &&
      comment.body === "동시 내보내기 제한은 몇 개인가요?"
    ));
    assert.equal(decideDraftApply(project, draftId, proposal.id, "approved", scheduling).changed, false);
    assert.throws(
      () => updateDraftCommentStatus(project, draftId, planning.comments[0].id, "resolved"),
      /applied draft comments/
    );
    assert.equal(recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 1,
      selectedCommentIds,
      idempotencyKey: "proposal-1"
    }).id, proposal.id, "an apply retry remains idempotent after approval changed the revision");

    const undone = undoDraftApply(project, draftId, proposal.id, scheduling);
    assert.equal(undone.history.status, "undone");
    assert.equal(undone.snapshot.session.currentRevision, 3);
    assert.equal(undone.snapshot.revisions.at(-1)?.content, original);
    assert.equal(undoDraftApply(project, draftId, proposal.id, scheduling).changed, false);

    const restored = restoreDraftRevision(project, draftId, { expectedRevision: 3, revision: 2 }, scheduling);
    assert.equal(restored.snapshot.session.currentRevision, 4);
    assert.equal(restored.snapshot.revisions.at(-1)?.content, proposal.result?.proposedContent);
    assert.ok(restored.snapshot.events.some((event) => event.type === "draft.revision.restored"));

    const revision4Requests = await waitForDraft(project, draftId, (snapshot) =>
      snapshot.requests.some((request) => request.revision === 4 && request.status === "pending")
    );
    const currentRequest = revision4Requests.requests.find((request) => request.revision === 4 && request.status === "pending");
    assert.ok(currentRequest);
    claimDraftReviewRequest(project, currentRequest.id);
    const currentComment = submitDraftReview(project, currentRequest.id, {
      comments: [{ kind: "suggestion", body: "완료 후 결과 파일 크기를 표시한다.", idempotencyKey: "size" }]
    }).comments[0];
    const superseded = recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 4,
      selectedCommentIds: [currentComment.id],
      idempotencyKey: "superseded"
    });
    updateDraftRevision(project, draftId, {
      expectedRevision: 4,
      content: `${proposal.result?.proposedContent}\n\n추가 사용자 수정`
    }, scheduling);
    assert.throws(
      () => decideDraftApply(project, draftId, superseded.id, "approved", scheduling),
      DraftRevisionConflictError
    );
    assert.equal(getDraftSnapshot(project, draftId).comments.find((comment) => comment.id === currentComment.id)?.stale, true);
  } finally {
    if (projectPath) cancelDraftReviewTimers(projectPath, draftId || undefined);
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForDraft(
  project: Parameters<typeof getDraftSnapshot>[0],
  draftId: string,
  predicate: (snapshot: ReturnType<typeof getDraftSnapshot>) => boolean
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = getDraftSnapshot(project, draftId);
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for draft apply test state.");
}
