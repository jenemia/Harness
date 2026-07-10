import { api } from "../api/client";
import type { DraftComment, DraftReviewRequest, DraftSnapshot } from "../api/contracts";
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
};
