import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeApplicationCommand } from "../src/application.js";
import {
  DraftRevisionConflictError,
  cancelDraftReviewTimers,
  claimDraftReviewRequest,
  createDraftReply,
  createDraftSession,
  getDraftSnapshot,
  recordDraftApplyAttempt,
  recoverDraftReviewRequests,
  replayDraftEvents,
  submitDraftReview,
  updateDraftRevision
} from "../src/drafts.js";
import { registerProjectService } from "../src/services.js";

test("draft collaboration persists revisions, debounce, stale reviews, replies, apply history, replay, and recovery", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-drafts-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  const scheduling = { debounceMs: 25, rateLimitMs: 80 };
  let projectPath = "";
  let draftId = "";
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    projectPath = project.path;
    const created = createDraftSession(project);
    draftId = created.session.id;
    assert.equal(created.session.currentRevision, 1);
    assert.equal(created.reviewers.length, 2);
    assert.equal(created.requests.length, 0);

    const revision2 = updateDraftRevision(project, draftId, {
      expectedRevision: 1,
      content: "Implement an export flow with explicit acceptance criteria."
    }, scheduling);
    assert.equal(revision2.snapshot.session.currentRevision, 2);
    assert.equal(revision2.snapshot.requests.filter((request) => request.revision === 2).length, 2);

    const revision3 = updateDraftRevision(project, draftId, {
      expectedRevision: 2,
      content: "Implement an export flow with validation, failure handling, and explicit acceptance criteria."
    }, scheduling);
    assert.equal(revision3.snapshot.requests.filter((request) => request.revision === 2).every((request) => request.status === "cancelled"), true);
    const unchanged = updateDraftRevision(project, draftId, {
      expectedRevision: 3,
      content: "Implement an export flow with validation, failure handling, and explicit acceptance criteria."
    }, scheduling);
    assert.equal(unchanged.deduplicated, true);
    assert.throws(
      () => updateDraftRevision(project, draftId, { expectedRevision: 2, content: "conflict" }, scheduling),
      DraftRevisionConflictError
    );

    let snapshot = await waitForDraft(project, draftId, (value) =>
      value.requests.filter((request) => request.revision === 3 && request.status === "pending").length === 2
    );
    const oldRequest = snapshot.requests.find((request) => request.revision === 3 && request.status === "pending");
    assert.ok(oldRequest);
    assert.equal(claimDraftReviewRequest(project, oldRequest.id).status, "running");

    const revision4 = updateDraftRevision(project, draftId, {
      expectedRevision: 3,
      content: "Implement a resumable export flow with validation, failure handling, and explicit acceptance criteria."
    }, scheduling);
    assert.ok(revision4.snapshot.reviewers.some((reviewer) => reviewer.status === "rate-limited"));
    assert.ok(revision4.snapshot.requests
      .filter((request) => request.revision === 4)
      .every((request) => Date.parse(request.availableAt) > Date.now()));
    const staleResult = submitDraftReview(project, oldRequest.id, {
      comments: [{ kind: "risk", body: "Clarify partial export cleanup.", idempotencyKey: "old-risk" }]
    });
    assert.equal(staleResult.request.status, "stale");
    assert.equal(staleResult.comments[0]?.stale, true);
    assert.equal(staleResult.comments[0]?.status, "stale");
    const repeatedStale = submitDraftReview(project, oldRequest.id, {
      comments: [{ kind: "risk", body: "Clarify partial export cleanup.", idempotencyKey: "old-risk" }]
    });
    assert.equal(repeatedStale.comments.length, 1);
    assert.throws(
      () => recordDraftApplyAttempt(project, draftId, {
        expectedRevision: 4,
        selectedCommentIds: [staleResult.comments[0].id],
        idempotencyKey: "stale-apply"
      }),
      /Stale draft comment cannot be applied/
    );

    snapshot = await waitForDraft(project, draftId, (value) =>
      value.requests.filter((request) => request.revision === 4 && request.status === "pending").length === 2
    );
    const freshRequest = snapshot.requests.find((request) => request.revision === 4 && request.status === "pending");
    assert.ok(freshRequest);
    claimDraftReviewRequest(project, freshRequest.id);
    const freshResult = submitDraftReview(project, freshRequest.id, {
      comments: [{ kind: "question", body: "Which export formats are in scope?", idempotencyKey: "fresh-question" }]
    });
    const freshComment = freshResult.comments[0];
    assert.equal(freshResult.request.status, "completed");
    assert.equal(freshComment.stale, false);

    const reply = createDraftReply(project, draftId, {
      parentCommentId: freshComment.id,
      body: "CSV only for the first release.",
      idempotencyKey: "reply-1"
    });
    const duplicateReply = createDraftReply(project, draftId, {
      parentCommentId: freshComment.id,
      body: "CSV only for the first release.",
      idempotencyKey: "reply-1"
    });
    assert.equal(duplicateReply.id, reply.id);

    const apply = recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 4,
      selectedCommentIds: [freshComment.id],
      idempotencyKey: "apply-1"
    });
    const duplicateApply = recordDraftApplyAttempt(project, draftId, {
      expectedRevision: 4,
      selectedCommentIds: [freshComment.id],
      idempotencyKey: "apply-1"
    });
    assert.equal(duplicateApply.id, apply.id);
    assert.equal(apply.status, "pending");

    const allEvents = replayDraftEvents(project, draftId);
    assert.deepEqual(allEvents.map((event) => event.sequence), allEvents.map((_, index) => index + 1));
    const cursor = Math.max(0, allEvents.length - 2);
    assert.deepEqual(
      replayDraftEvents(project, draftId, cursor).map((event) => event.sequence),
      allEvents.filter((event) => event.sequence > cursor).map((event) => event.sequence)
    );

    updateDraftRevision(project, draftId, {
      expectedRevision: 4,
      content: "Implement a resumable CSV export flow with validation, cleanup, and explicit acceptance criteria."
    }, scheduling);
    snapshot = await waitForDraft(project, draftId, (value) =>
      value.requests.some((request) => request.revision === 5 && request.status === "pending")
    );
    const interrupted = snapshot.requests.find((request) => request.revision === 5 && request.status === "pending");
    assert.ok(interrupted);
    assert.equal(claimDraftReviewRequest(project, interrupted.id).status, "running");
    const recovered = recoverDraftReviewRequests(project, scheduling);
    assert.equal(recovered.recovered, 1);
    assert.equal(getDraftSnapshot(project, draftId).requests.find((request) => request.id === interrupted.id)?.status, "pending");

    const reopened = getDraftSnapshot(project, draftId);
    assert.equal(reopened.session.currentRevision, 5);
    assert.equal(reopened.revisions.length, 5);
    assert.ok(reopened.comments.some((comment) => comment.id === reply.id));
    assert.ok(reopened.applyHistory.some((history) => history.id === apply.id));

    assert.throws(
      () => updateDraftRevision(project, draftId, { expectedRevision: 5, content: "api_key=supersecretvalue" }, scheduling),
      /API keys, tokens, or credentials/
    );

    const viaApplication = await invokeApplicationCommand("drafts:create", { projectId: project.id, payload: {} }) as {
      draft: { session: { id: string } };
    };
    const fetched = await invokeApplicationCommand("drafts:get", {
      projectId: project.id,
      draftId: viaApplication.draft.session.id
    }) as { draft: { session: { id: string } } };
    assert.equal(fetched.draft.session.id, viaApplication.draft.session.id);
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = getDraftSnapshot(project, draftId);
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for draft review scheduling.");
}
