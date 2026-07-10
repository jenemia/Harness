import { api } from "../api/client";
import type { DraftApplyHistory, DraftComment, DraftReviewRequest, DraftSnapshot } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const draftService = {
  create: (projectId: string, content = "") => desktopOrHttp(
    "drafts:create",
    { projectId, payload: { content } },
    () => api<{ draft: DraftSnapshot }>(`/api/projects/${projectId}/drafts`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  ) as Promise<{ draft: DraftSnapshot }>,

  get: (projectId: string, draftId: string) => desktopOrHttp(
    "drafts:get",
    { projectId, draftId },
    () => api<{ draft: DraftSnapshot }>(`/api/projects/${projectId}/drafts/${draftId}`),
  ) as Promise<{ draft: DraftSnapshot }>,

  update: (projectId: string, draftId: string, expectedRevision: number, content: string) => desktopOrHttp(
    "drafts:update",
    { projectId, draftId, expectedRevision, content },
    () => api<{ draft: { snapshot: DraftSnapshot; deduplicated: boolean } }>(`/api/projects/${projectId}/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision, content }),
    }),
  ) as Promise<{ draft: { snapshot: DraftSnapshot; deduplicated: boolean } }>,

  reply: (
    projectId: string,
    draftId: string,
    payload: { parentCommentId: string; body: string; author?: string; idempotencyKey?: string },
  ) => desktopOrHttp(
    "drafts:reply",
    { projectId, draftId, payload },
    () => api<{ comment: DraftComment }>(`/api/projects/${projectId}/drafts/${draftId}/replies`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ) as Promise<{ comment: DraftComment }>,

  setCommentStatus: (projectId: string, draftId: string, commentId: string, status: "open" | "resolved") => desktopOrHttp(
    "drafts:comment-status",
    { projectId, draftId, commentId, status },
    () => api<{ comment: DraftComment }>(`/api/projects/${projectId}/drafts/${draftId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  ) as Promise<{ comment: DraftComment }>,

  stopReview: (projectId: string, requestId: string) => desktopOrHttp(
    "drafts:stop-review",
    { projectId, requestId },
    () => api<{ request: DraftReviewRequest }>(`/api/projects/${projectId}/draft-review-requests/${requestId}/stop`, { method: "POST" }),
  ) as Promise<{ request: DraftReviewRequest }>,

  retryReview: (projectId: string, requestId: string) => desktopOrHttp(
    "drafts:retry-review",
    { projectId, requestId },
    () => api<{ request: DraftReviewRequest }>(`/api/projects/${projectId}/draft-review-requests/${requestId}/retry`, { method: "POST" }),
  ) as Promise<{ request: DraftReviewRequest }>,

  requestApply: (
    projectId: string,
    draftId: string,
    payload: { expectedRevision: number; selectedCommentIds: string[]; idempotencyKey: string },
  ) => desktopOrHttp(
    "drafts:apply-request",
    { projectId, draftId, payload },
    () => api<{ apply: DraftApplyHistory }>(`/api/projects/${projectId}/drafts/${draftId}/applies`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ) as Promise<{ apply: DraftApplyHistory }>,

  decideApply: (projectId: string, draftId: string, applyId: string, decision: "approved" | "rejected") => desktopOrHttp(
    "drafts:apply-decision",
    { projectId, draftId, applyId, decision },
    () => api<{ apply: { history: DraftApplyHistory; snapshot: DraftSnapshot; changed: boolean } }>(
      `/api/projects/${projectId}/drafts/${draftId}/applies/${applyId}/decision`,
      { method: "POST", body: JSON.stringify({ decision }) },
    ),
  ) as Promise<{ apply: { history: DraftApplyHistory; snapshot: DraftSnapshot; changed: boolean } }>,

  undoApply: (projectId: string, draftId: string, applyId: string) => desktopOrHttp(
    "drafts:apply-undo",
    { projectId, draftId, applyId },
    () => api<{ apply: { history: DraftApplyHistory; snapshot: DraftSnapshot; changed: boolean } }>(
      `/api/projects/${projectId}/drafts/${draftId}/applies/${applyId}/undo`,
      { method: "POST" },
    ),
  ) as Promise<{ apply: { history: DraftApplyHistory; snapshot: DraftSnapshot; changed: boolean } }>,

  restoreRevision: (projectId: string, draftId: string, expectedRevision: number, revision: number) => desktopOrHttp(
    "drafts:restore-revision",
    { projectId, draftId, expectedRevision, revision },
    () => api<{ draft: { snapshot: DraftSnapshot; deduplicated: boolean } }>(
      `/api/projects/${projectId}/drafts/${draftId}/restore`,
      { method: "POST", body: JSON.stringify({ expectedRevision, revision }) },
    ),
  ) as Promise<{ draft: { snapshot: DraftSnapshot; deduplicated: boolean } }>,
};
