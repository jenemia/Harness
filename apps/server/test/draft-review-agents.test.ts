import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDraftReviewAgentRuntime, retryDraftReview, stopDraftReview } from "../src/draft-review-agents.js";
import {
  cancelDraftReviewTimers,
  createDraftReply,
  createDraftSession,
  getDraftSnapshot,
  updateDraftCommentStatus,
  updateDraftRevision
} from "../src/drafts.js";
import { registerProjectService } from "../src/services.js";

test("local draft reviewer agents stream progress, stop, retry, and answer user replies without loops", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-draft-reviewers-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  let projectPath = "";
  let draftId = "";
  try {
    ensureDraftReviewAgentRuntime();
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    projectPath = project.path;
    const scheduling = { debounceMs: 5, rateLimitMs: 5, autoReview: true };
    const created = createDraftSession(project, {
      content: "외부 API에서 파일을 내려받아 저장한다."
    }, scheduling);
    draftId = created.session.id;

    let snapshot = await waitForSnapshot(project, draftId, (value) =>
      value.requests.filter((request) => request.revision === 1 && request.status === "completed").length === 2
    );
    assert.ok(snapshot.events.some((event) => event.type === "draft.review.progress"));
    assert.ok(snapshot.comments.some((comment) => comment.kind === "question"));
    assert.ok(snapshot.comments.some((comment) => comment.kind === "risk"));
    const plannerReview = snapshot.comments.find((comment) => comment.reviewerId === snapshot.reviewers.find((reviewer) => reviewer.role === "planner")?.id);
    assert.match(plannerReview?.body || "", /구현 방향/);
    assert.match(plannerReview?.body || "", /사이드 이펙트/);
    assert.match(plannerReview?.body || "", /보완할 내용/);
    assert.match(plannerReview?.body || "", /요청\/응답 및 저장 모델/);
    assert.doesNotMatch(plannerReview?.body || "", /작업 범위, 제외 범위, 의존성, 담당 역할을 구분하면/);

    const revision2 = updateDraftRevision(project, draftId, {
      expectedRevision: 1,
      content: "외부 API에서 파일을 내려받아 저장하고 오류 시 재시도한다. 완료 조건은 통합 테스트 통과다."
    }, scheduling);
    assert.equal(revision2.snapshot.session.currentRevision, 2);
    snapshot = await waitForSnapshot(project, draftId, (value) =>
      value.requests.some((request) => request.revision === 2 && request.status === "running")
    );
    const running = snapshot.requests.find((request) => request.revision === 2 && request.status === "running");
    assert.ok(running);
    assert.equal(stopDraftReview(project, running.id).status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 280));
    snapshot = getDraftSnapshot(project, draftId);
    assert.equal(snapshot.requests.find((request) => request.id === running.id)?.status, "cancelled");
    assert.equal(snapshot.comments.some((comment) => comment.revision === 2 && comment.reviewerId === running.reviewerId), false);

    assert.equal(retryDraftReview(project, running.id).status, "pending");
    snapshot = await waitForSnapshot(project, draftId, (value) =>
      value.requests.find((request) => request.id === running.id)?.status === "completed"
    );
    const reviewerComment = snapshot.comments.find(
      (comment) => comment.reviewerId === running.reviewerId
    );
    assert.ok(reviewerComment);

    const beforeReplyRequests = snapshot.requests.length;
    const reply = createDraftReply(project, draftId, {
      parentCommentId: reviewerComment.id,
      body: `@${snapshot.reviewers.find((reviewer) => reviewer.id === running.reviewerId)?.role} 재시도는 최대 2회로 제한합니다.`,
      idempotencyKey: "reply-turn"
    }, scheduling);
    assert.equal(reply.kind, "reply");
    snapshot = await waitForSnapshot(project, draftId, (value) =>
      value.requests.length === beforeReplyRequests + 1 &&
      value.requests[value.requests.length - 1]?.status === "completed"
    );
    const followUpComment = snapshot.comments.find((comment) =>
      comment.reviewerId === running.reviewerId && comment.body.includes("재시도는 최대 2회")
    );
    assert.ok(followUpComment);
    const repeatedBodies = snapshot.comments
      .filter((comment) => comment.reviewerId === running.reviewerId)
      .map((comment) => comment.body);
    assert.equal(new Set(repeatedBodies).size, repeatedBodies.length);
    assert.equal(updateDraftCommentStatus(project, draftId, followUpComment.id, "resolved").status, "resolved");
    assert.equal(updateDraftCommentStatus(project, draftId, followUpComment.id, "open").status, "open");

    const stableRequestCount = snapshot.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(getDraftSnapshot(project, draftId).requests.length, stableRequestCount);
  } finally {
    if (projectPath) cancelDraftReviewTimers(projectPath, draftId || undefined);
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForSnapshot(
  project: Parameters<typeof getDraftSnapshot>[0],
  draftId: string,
  predicate: (snapshot: ReturnType<typeof getDraftSnapshot>) => boolean
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = getDraftSnapshot(project, draftId);
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for draft reviewer agent.");
}
