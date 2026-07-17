import { api } from "../api/client";
import type { CodeReviewFinding, CodeReviewJob, CompletionReport, InlineReviewComment, RunFileReview, Task } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const reviewService = {
  listAutomatic: (projectId: string, taskId?: string) => desktopOrHttp(
    "reviews:auto-list", { projectId, taskId },
    () => api<{ jobs: CodeReviewJob[]; findings: CodeReviewFinding[] }>(`/api/projects/${projectId}/code-reviews${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`),
  ) as Promise<{ jobs: CodeReviewJob[]; findings: CodeReviewFinding[] }>,
  retryAutomatic: (projectId: string, jobId: string) => desktopOrHttp(
    "reviews:auto-retry", { projectId, jobId },
    () => api<{ queued: true; jobId: string }>(`/api/projects/${projectId}/code-reviews/${jobId}/retry`, { method: "POST" }),
  ) as Promise<{ queued: true; jobId: string }>,
  updateAutomaticFinding: (projectId: string, findingId: string, status: "addressed" | "dismissed", reason?: string) => desktopOrHttp(
    "reviews:auto-finding-update", { projectId, findingId, status, reason },
    () => api<{ finding: CodeReviewFinding }>(`/api/projects/${projectId}/code-review-findings/${findingId}`, { method: "PATCH", body: JSON.stringify({ status, reason }) }),
  ) as Promise<{ finding: CodeReviewFinding }>,
  report: (projectId: string, runId: string) => desktopOrHttp(
    "reviews:report", { projectId, runId },
    () => api<{ report: CompletionReport; html: string }>(`/api/projects/${projectId}/runs/${runId}/completion-report`),
  ) as Promise<{ report: CompletionReport; html: string }>,
  diff: (projectId: string, runId: string, filePath: string, ignoreWhitespace = false, offset = 0) => desktopOrHttp(
    "reviews:diff", { projectId, runId, filePath, ignoreWhitespace, offset, limit: 400 },
    () => api<{ file: RunFileReview; diff: string; offset: number; nextOffset: number | null; totalLines: number; unavailableReason: string | null }>(
      `/api/projects/${projectId}/runs/${runId}/diff?filePath=${encodeURIComponent(filePath)}&ignoreWhitespace=${ignoreWhitespace}&offset=${offset}&limit=400`,
    ),
  ) as Promise<{ file: RunFileReview; diff: string; offset: number; nextOffset: number | null; totalLines: number; unavailableReason: string | null }>,
  updateFile: (projectId: string, runId: string, filePath: string, payload: { status?: "unreviewed" | "reviewed"; recommendationOrder?: number | null }) => desktopOrHttp(
    "reviews:file-update", { projectId, runId, filePath, ...payload },
    () => api<{ file: RunFileReview }>(`/api/projects/${projectId}/runs/${runId}/file-review`, { method: "PATCH", body: JSON.stringify({ filePath, ...payload }) }),
  ) as Promise<{ file: RunFileReview }>,
  createComment: (projectId: string, runId: string, payload: { filePath: string; line: number; side: "old" | "new"; body: string }) => desktopOrHttp(
    "reviews:comment-create", { projectId, runId, ...payload },
    () => api<{ comment: InlineReviewComment }>(`/api/projects/${projectId}/runs/${runId}/review-comments`, { method: "POST", body: JSON.stringify(payload) }),
  ) as Promise<{ comment: InlineReviewComment }>,
  updateComment: (projectId: string, commentId: string, status: "open" | "addressed" | "dismissed") => desktopOrHttp(
    "reviews:comment-update", { projectId, commentId, status },
    () => api<{ comment: InlineReviewComment }>(`/api/projects/${projectId}/review-comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  ) as Promise<{ comment: InlineReviewComment }>,
  createFollowUp: (projectId: string, runId: string, commentIds: string[]) => desktopOrHttp(
    "reviews:followup", { projectId, runId, commentIds },
    () => api<{ task: Task; comments: InlineReviewComment[] }>(`/api/projects/${projectId}/runs/${runId}/review-followups`, { method: "POST", body: JSON.stringify({ commentIds }) }),
  ) as Promise<{ task: Task; comments: InlineReviewComment[] }>,
};
