import {
  getProjectSettingsFromDb,
  listGlobalMemories,
  mapAgent,
  mapApproval,
  mapComment,
  mapCompletionReport,
  mapDocument,
  mapDraftApplyHistory,
  mapDraftComment,
  mapDraftEvent,
  mapDraftReviewer,
  mapDraftReviewRequest,
  mapDraftRevision,
  mapDraftSession,
  mapEvent,
  mapHandoff,
  mapInlineReviewComment,
  mapInteraction,
  mapMemory,
  mapPreview,
  mapProjectGoal,
  mapProviderEvent,
  mapRun,
  mapRunFileReview,
  mapTask,
  mapTaskGoal,
  openProjectDb
} from "./db.js";
import type { ProjectOverview, ProjectRecord } from "./types.js";
import { mapCodeReviewFinding, mapCodeReviewJob } from "./code-reviews.js";

export type ProjectOverviewSection = "board" | "activity" | "collaboration" | "reviews";

const allSections: ProjectOverviewSection[] = ["board", "activity", "collaboration", "reviews"];

export function getProjectOverview(project: ProjectRecord): ProjectOverview {
  return getProjectOverviewSections(project, allSections) as ProjectOverview;
}
export function getProjectOverviewSections(
  project: ProjectRecord,
  sections: readonly ProjectOverviewSection[]
): Partial<ProjectOverview> & Pick<ProjectOverview, "project" | "settings"> {
  const requested = new Set(sections);
  const db = openProjectDb(project.path);
  try {
    const result: Partial<ProjectOverview> & Pick<ProjectOverview, "project" | "settings"> = {
      project,
      settings: getProjectSettingsFromDb(db)
    };
    if (requested.has("board")) Object.assign(result, {
      agents: db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent),
      tasks: db.prepare("SELECT * FROM tasks ORDER BY task_order ASC, created_at ASC").all().map(mapTask),
      projectGoals: db.prepare("SELECT * FROM project_goals ORDER BY status, created_at ASC").all().map(mapProjectGoal),
      taskGoals: db.prepare("SELECT * FROM task_goals ORDER BY task_id, goal_order ASC").all().map(mapTaskGoal),
      approvals: db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100").all().map(mapApproval),
      previews: db.prepare("SELECT * FROM previews ORDER BY created_at ASC").all().map(mapPreview),
      interactions: db.prepare("SELECT * FROM interactions ORDER BY created_at DESC LIMIT 500").all().map(mapInteraction),
      handoffs: db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC LIMIT 100").all().map(mapHandoff),
      comments: db.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT 200").all().map(mapComment)
    });
    if (requested.has("activity")) Object.assign(result, {
      events: db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT 200").all().map(mapEvent),
      providerEvents: db.prepare("SELECT * FROM provider_events ORDER BY timestamp DESC, sequence DESC LIMIT 500").all().map(mapProviderEvent),
      runs: db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 100").all().map(mapRun)
    });
    if (requested.has("collaboration")) Object.assign(result, {
      documents: db.prepare("SELECT * FROM documents ORDER BY updated_at DESC").all().map(mapDocument),
      memories: db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory),
      globalMemories: listGlobalMemories(),
      draftSessions: db.prepare("SELECT * FROM draft_sessions ORDER BY updated_at DESC LIMIT 100").all().map(mapDraftSession),
      draftRevisions: db.prepare("SELECT * FROM draft_revisions ORDER BY created_at DESC LIMIT 500").all().map(mapDraftRevision),
      draftReviewers: db.prepare("SELECT * FROM draft_reviewers ORDER BY created_at ASC LIMIT 300").all().map(mapDraftReviewer),
      draftReviewRequests: db.prepare("SELECT * FROM draft_review_requests ORDER BY requested_at DESC LIMIT 500").all().map(mapDraftReviewRequest),
      draftComments: db.prepare("SELECT * FROM draft_comments ORDER BY created_at ASC LIMIT 1000").all().map(mapDraftComment),
      draftApplyHistory: db.prepare("SELECT * FROM draft_apply_history ORDER BY created_at DESC LIMIT 500").all().map(mapDraftApplyHistory),
      draftEvents: db.prepare("SELECT * FROM draft_events ORDER BY created_at DESC, sequence DESC LIMIT 1000").all().map(mapDraftEvent)
    });
    if (requested.has("reviews")) {
      Object.assign(result, {
        completionReports: db.prepare("SELECT * FROM completion_reports ORDER BY created_at DESC LIMIT 100").all().map(mapCompletionReport),
        runFileReviews: db.prepare("SELECT * FROM run_file_reviews ORDER BY recommendation_order IS NULL, recommendation_order, path LIMIT 1000").all().map(mapRunFileReview),
        inlineReviewComments: db.prepare("SELECT * FROM inline_review_comments ORDER BY created_at DESC LIMIT 1000").all().map(mapInlineReviewComment),
        codeReviewJobs: db.prepare("SELECT * FROM code_review_jobs ORDER BY created_at DESC LIMIT 500").all().map(mapCodeReviewJob),
        codeReviewFindings: db.prepare("SELECT * FROM code_review_findings ORDER BY created_at DESC LIMIT 2000").all().map(mapCodeReviewFinding)
      });
    }
    return result;
  } finally {
    db.close();
  }
}
