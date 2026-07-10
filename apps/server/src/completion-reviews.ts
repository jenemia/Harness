import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getProjectSettingsFromDb,
  insertEvent,
  mapCompletionReport,
  mapInlineReviewComment,
  mapRun,
  mapRunFileReview,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import { assertNoCredentialMaterial, redactCredentialMaterial } from "./credential-security.js";
import { withProjectWriterLock } from "./project-store.js";
import { createTaskService } from "./services.js";
import type {
  CompletionReportRecord,
  InlineReviewCommentRecord,
  ProjectRecord,
  RunFileReviewRecord,
  RunRecord,
  TaskRecord
} from "./types.js";

const terminalRunStatuses = new Set<RunRecord["status"]>(["completed", "failed"]);
const reviewStatuses = new Set<RunFileReviewRecord["status"]>(["unreviewed", "reviewed"]);
const commentStatuses = new Set<InlineReviewCommentRecord["status"]>(["open", "addressed", "dismissed"]);
const highRiskPatterns = [
  /(^|\/)(auth|security|permissions?|credentials?)(\/|\.|$)/i,
  /(^|\/)(migrations?|schema|database|db)(\/|\.|$)/i,
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i,
  /(^|\/)(api|routes?|public)(\/|\.|$)/i,
  /(^|\/)(\.github|docker|infra|deploy)(\/|\.|$)/i,
  /(^|\/)(index|main|server|app)\.[cm]?[jt]sx?$/i
];

type DiffFile = {
  path: string;
  previousPath: string | null;
  changeType: RunFileReviewRecord["changeType"];
  additions: number;
  deletions: number;
  binary: boolean;
  riskReasons: string[];
  sourceStatus: string;
};

type StructuredCompletion = NonNullable<import("./providers.js").LlmRunResult["completion"]>;

export function generateCompletionReport(project: ProjectRecord, runId: string, completion?: StructuredCompletion) {
  return withProjectWriterLock(project.path, () => generateCompletionReportMutation(project, runId, completion));
}

function generateCompletionReportMutation(project: ProjectRecord, runId: string, completion?: StructuredCompletion) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM completion_reports WHERE run_id = ?").get(runId);
    if (existing) return mapCompletionReport(existing);
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!runRow) throw new Error("Run not found.");
    const run = mapRun(runRow);
    if (!terminalRunStatuses.has(run.status)) throw new Error("Completion reports require a terminal run.");
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(run.taskId);
    if (!taskRow) throw new Error("Task not found.");
    const task = mapTask(taskRow);
    const settings = getProjectSettingsFromDb(db);
    const completionRef = resolveCompletionRef(run);
    pinRunRefs(run, completionRef);
    const files = collectDiffFiles(run, completionRef);
    const metrics = summarizeFiles(files);
    const warning = metrics.files > settings.maxReviewFiles || metrics.additions + metrics.deletions > settings.maxReviewDiffLines
      ? `Review size exceeds the project recommendation (${settings.maxReviewFiles} files / ${settings.maxReviewDiffLines} lines). Split follow-up work before merge.`
      : null;
    const report = buildStructuredReport(task, run, completionRef, files, warning, completion);
    const revision = Number((db.prepare("SELECT MAX(revision) AS value FROM completion_reports WHERE task_id = ?").get(task.id) as { value?: number }).value || 0) + 1;
    const id = randomUUID();
    const createdAt = now();
    const reportDir = path.join(projectHarnessDir(project.path), "reports", run.id);
    const htmlPath = path.join(reportDir, "completion-report.html");
    const html = renderCompletionHtml(task, report, files, revision);
    const htmlHash = createHash("sha256").update(html).digest("hex");
    let storedHtmlPath: string | null = null;
    try {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(htmlPath, html, { encoding: "utf8", mode: 0o600 });
      storedHtmlPath = htmlPath;
    } catch {
      storedHtmlPath = null;
    }
    db.prepare(`
      INSERT INTO completion_reports (
        id, run_id, task_id, revision, completion_ref, html_path, html_hash, mime_type, plain_text, summary,
        acceptance_criteria, decisions, validations, limitations, follow_ups, metrics, warning, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'text/html', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, run.id, task.id, revision, completionRef, storedHtmlPath, htmlHash, report.plainText, report.summary,
      JSON.stringify(report.acceptanceCriteria), JSON.stringify(report.decisions), JSON.stringify(report.validations),
      JSON.stringify(report.limitations), JSON.stringify(report.followUps), JSON.stringify(metrics), warning, createdAt
    );
    const recommendations = rankReviewFiles(files);
    const linkedCriterion = task.acceptanceCriteria.split(/\n|;/).map((item) => item.trim()).find(Boolean) || "terminal run result";
    const recommendationByPath = new Map(recommendations.map((item, index) => [item.path, {
      order: index + 1,
      reason: `${recommendationReason(item)}; verify: ${linkedCriterion}`
    }]));
    const fileStmt = db.prepare(`
      INSERT INTO run_file_reviews (
        id, run_id, task_id, path, previous_path, status, change_type, additions, deletions,
        binary, risk, risk_reasons, recommendation_order, recommendation_reason, reviewed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'unreviewed', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `);
    for (const file of files) {
      const recommended = recommendationByPath.get(file.path);
      fileStmt.run(
        randomUUID(), run.id, task.id, file.path, file.previousPath, file.changeType, file.additions, file.deletions,
        file.binary ? 1 : 0, file.riskReasons.length ? "high" : "normal", JSON.stringify(file.riskReasons),
        recommended?.order || null, recommended?.reason || null, createdAt
      );
    }
    db.prepare(`
      UPDATE inline_review_comments
      SET status = 'addressed', addressed_by_run_id = ?, updated_at = ?
      WHERE follow_up_task_id = ? AND status = 'open'
    `).run(run.id, createdAt, task.id);
    insertEvent(db, {
      taskId: task.id,
      agentId: run.agentId,
      type: "completion.report.created",
      message: `Completion report revision ${revision} recorded ${metrics.files} changed file(s).`,
      metadata: { runId: run.id, reportId: id, revision, completionRef, metrics, warning, htmlStored: Boolean(storedHtmlPath) }
    });
    return mapCompletionReport(db.prepare("SELECT * FROM completion_reports WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

export function readCompletionReportHtml(project: ProjectRecord, runId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM completion_reports WHERE run_id = ?").get(runId);
    if (!row) throw new Error("Completion report not found.");
    const report = mapCompletionReport(row);
    const html = report.htmlPath && existsSync(report.htmlPath) ? readFileSync(report.htmlPath, "utf8") : renderPlainTextFallback(report);
    return { report, html };
  } finally {
    db.close();
  }
}

export function readRunDiff(project: ProjectRecord, runId: string, filePath: string, input: {
  ignoreWhitespace?: boolean;
  offset?: number;
  limit?: number;
} = {}) {
  const db = openProjectDb(project.path);
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    const reportRow = db.prepare("SELECT * FROM completion_reports WHERE run_id = ?").get(runId);
    const fileRow = db.prepare("SELECT * FROM run_file_reviews WHERE run_id = ? AND path = ?").get(runId, filePath);
    if (!runRow || !reportRow || !fileRow) throw new Error("Reviewed run file not found.");
    const run = mapRun(runRow);
    const report = mapCompletionReport(reportRow);
    const file = mapRunFileReview(fileRow);
    if (!run.worktreePath || !run.snapshotRef || !report.completionRef || file.binary) {
      return { file, diff: "", offset: 0, nextOffset: null, totalLines: 0, unavailableReason: file.binary ? "Binary diff is unavailable." : "Snapshot diff is unavailable." };
    }
    const args = ["diff", "--no-ext-diff", "--unified=3"];
    if (input.ignoreWhitespace) args.push("--ignore-all-space");
    args.push(run.snapshotRef, report.completionRef, "--", file.path);
    let diff = "";
    try {
      diff = runGit(existsSync(run.worktreePath) ? run.worktreePath : project.path, args, 16 * 1024 * 1024);
    } catch {
      return { file, diff: "", offset: 0, nextOffset: null, totalLines: 0, unavailableReason: "Diff is unavailable or exceeds the safe rendering limit." };
    }
    const lines = diff.split("\n");
    const offset = Math.max(0, Number(input.offset || 0));
    const limit = Math.min(1000, Math.max(20, Number(input.limit || 400)));
    const nextOffset = offset + limit < lines.length ? offset + limit : null;
    return { file, diff: lines.slice(offset, offset + limit).join("\n"), offset, nextOffset, totalLines: lines.length, unavailableReason: null };
  } finally {
    db.close();
  }
}

export function updateRunFileReview(project: ProjectRecord, runId: string, filePath: string, input: {
  status?: RunFileReviewRecord["status"];
  recommendationOrder?: number | null;
}) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM run_file_reviews WHERE run_id = ? AND path = ?").get(runId, filePath);
      if (!row) throw new Error("Run file review not found.");
      const current = mapRunFileReview(row);
      if (input.status && !reviewStatuses.has(input.status)) throw new Error("File review status is invalid.");
      const status = input.status || current.status;
      const timestamp = now();
      const nextOrder = input.recommendationOrder === undefined ? current.recommendationOrder : input.recommendationOrder;
      if (nextOrder !== null && nextOrder !== current.recommendationOrder) {
        const displaced = db.prepare(`
          SELECT * FROM run_file_reviews WHERE run_id = ? AND recommendation_order = ? AND id != ?
        `).get(runId, nextOrder, current.id);
        if (displaced) {
          db.prepare("UPDATE run_file_reviews SET recommendation_order = ?, updated_at = ? WHERE id = ?").run(
            current.recommendationOrder,
            timestamp,
            mapRunFileReview(displaced).id
          );
        }
      }
      db.prepare(`
        UPDATE run_file_reviews SET status = ?, recommendation_order = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        status,
        nextOrder,
        status === "reviewed" ? current.reviewedAt || timestamp : null,
        timestamp,
        current.id
      );
      insertEvent(db, { taskId: current.taskId, agentId: null, type: "review.file.updated", message: `${current.path} marked ${status}.`, metadata: { runId, filePath: current.path, status } });
      return mapRunFileReview(db.prepare("SELECT * FROM run_file_reviews WHERE id = ?").get(current.id));
    } finally {
      db.close();
    }
  });
}

export function createInlineReviewComment(project: ProjectRecord, runId: string, input: {
  filePath: string;
  line: number;
  side: "old" | "new";
  body: string;
}) {
  return withProjectWriterLock(project.path, () => {
    if (!input.filePath?.trim() || !input.body?.trim() || !Number.isInteger(input.line) || input.line < 1) throw new Error("Inline review comment is invalid.");
    if (input.side !== "old" && input.side !== "new") throw new Error("Inline review side is invalid.");
    assertNoCredentialMaterial(input.body, "Inline review comment");
    const db = openProjectDb(project.path);
    try {
      const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
      const reportRow = db.prepare("SELECT * FROM completion_reports WHERE run_id = ?").get(runId);
      const fileRow = db.prepare("SELECT id FROM run_file_reviews WHERE run_id = ? AND path = ?").get(runId, input.filePath);
      if (!runRow || !reportRow || !fileRow) throw new Error("Reviewed run file not found.");
      const run = mapRun(runRow);
      if (!terminalRunStatuses.has(run.status)) throw new Error("Inline comments require a terminal run.");
      const report = mapCompletionReport(reportRow);
      const id = randomUUID();
      const timestamp = now();
      db.prepare(`
        INSERT INTO inline_review_comments (
          id, run_id, task_id, file_path, line, side, snapshot_ref, completion_ref,
          body, status, follow_up_task_id, addressed_by_run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?)
      `).run(id, run.id, run.taskId, input.filePath, input.line, input.side, run.snapshotRef, report.completionRef, input.body.trim(), timestamp, timestamp);
      insertEvent(db, { taskId: run.taskId, agentId: null, type: "review.comment.created", message: `Inline review comment added to ${input.filePath}:${input.line}.`, metadata: { runId, commentId: id, filePath: input.filePath, line: input.line, side: input.side } });
      return mapInlineReviewComment(db.prepare("SELECT * FROM inline_review_comments WHERE id = ?").get(id));
    } finally {
      db.close();
    }
  });
}

export function updateInlineReviewComment(project: ProjectRecord, commentId: string, status: InlineReviewCommentRecord["status"]) {
  return withProjectWriterLock(project.path, () => {
    if (!commentStatuses.has(status)) throw new Error("Inline review comment status is invalid.");
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM inline_review_comments WHERE id = ?").get(commentId);
      if (!row) throw new Error("Inline review comment not found.");
      const comment = mapInlineReviewComment(row);
      db.prepare("UPDATE inline_review_comments SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), comment.id);
      insertEvent(db, { taskId: comment.taskId, agentId: null, type: "review.comment.updated", message: `Inline review comment marked ${status}.`, metadata: { runId: comment.runId, commentId, status } });
      return mapInlineReviewComment(db.prepare("SELECT * FROM inline_review_comments WHERE id = ?").get(comment.id));
    } finally {
      db.close();
    }
  });
}

export function createReviewFollowUp(project: ProjectRecord, runId: string, commentIds: string[]) {
  commentIds = [...new Set(commentIds)];
  const db = openProjectDb(project.path);
  let run: RunRecord;
  let sourceTask: TaskRecord;
  let comments: InlineReviewCommentRecord[];
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!runRow) throw new Error("Run not found.");
    run = mapRun(runRow);
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(run.taskId);
    if (!taskRow) throw new Error("Task not found.");
    sourceTask = mapTask(taskRow);
    comments = commentIds.map((id) => {
      const row = db.prepare("SELECT * FROM inline_review_comments WHERE id = ? AND run_id = ? AND status = 'open'").get(id, runId);
      if (!row) throw new Error(`Open review comment not found: ${id}`);
      return mapInlineReviewComment(row);
    });
  } finally {
    db.close();
  }
  if (!comments.length) throw new Error("Select at least one open review comment.");
  const task = createTaskService(project, {
    title: `Address review: ${sourceTask.title}`,
    description: comments.map((comment) => `- ${comment.filePath}:${comment.line} (${comment.side}) ${comment.body}`).join("\n"),
    status: "Backlog",
    reporter: "review",
    parentTaskId: sourceTask.id,
    dependencyTaskIds: sourceTask.status === "Done" ? [sourceTask.id] : [],
    linkedFiles: [...new Set(comments.map((comment) => comment.filePath))],
    labels: ["follow-up", "review-follow-up"],
    workspaceMode: sourceTask.workspaceMode,
    acceptanceCriteria: "Selected inline review comments are addressed and verified."
  });
  return withProjectWriterLock(project.path, () => {
    const updateDb = openProjectDb(project.path);
    try {
      const timestamp = now();
      const stmt = updateDb.prepare("UPDATE inline_review_comments SET follow_up_task_id = ?, updated_at = ? WHERE id = ?");
      for (const comment of comments) stmt.run(task.id, timestamp, comment.id);
      insertEvent(updateDb, { taskId: sourceTask.id, agentId: null, type: "review.followup.created", message: `Created follow-up ${task.title} from ${comments.length} review comment(s).`, metadata: { runId, followUpTaskId: task.id, commentIds } });
      return { task, comments: commentIds.map((id) => mapInlineReviewComment(updateDb.prepare("SELECT * FROM inline_review_comments WHERE id = ?").get(id))) };
    } finally {
      updateDb.close();
    }
  });
}

function resolveCompletionRef(run: RunRecord) {
  if (!run.worktreePath || !run.snapshotRef || run.snapshotRef.startsWith("harness:")) return null;
  try {
    if (run.status === "failed" && run.changedFiles.length > 0) {
      const failedTree = runGit(run.worktreePath, ["stash", "create", `Harness failed run ${run.id}`]).trim();
      if (failedTree) return failedTree;
    }
    return runGit(run.worktreePath, ["rev-parse", "HEAD"]).trim() || null;
  } catch {
    return null;
  }
}

function pinRunRefs(run: RunRecord, completionRef: string | null) {
  if (!run.worktreePath || !run.snapshotRef || !completionRef || run.snapshotRef.startsWith("harness:")) return;
  const safeRunId = run.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  try {
    runGit(run.worktreePath, ["update-ref", `refs/harness/runs/${safeRunId}/snapshot`, run.snapshotRef]);
    runGit(run.worktreePath, ["update-ref", `refs/harness/runs/${safeRunId}/completion`, completionRef]);
  } catch {
    // The report still retains raw refs; diff rendering will show an unavailable fallback if Git cannot pin them.
  }
}

function collectDiffFiles(run: RunRecord, completionRef: string | null): DiffFile[] {
  if (!run.worktreePath || !run.snapshotRef || !completionRef) return run.changedFiles.map((filePath) => ({
    path: filePath, previousPath: null, changeType: "modified", additions: 0, deletions: 0, binary: false,
    riskReasons: classifyRisk(filePath, 0), sourceStatus: "M"
  }));
  try {
    const nameStatus = runGit(run.worktreePath, ["diff", "--name-status", "--find-renames", run.snapshotRef, completionRef]);
    const numstat = runGit(run.worktreePath, ["diff", "--numstat", "--find-renames", run.snapshotRef, completionRef]);
    const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [added, deleted, ...rest] = line.split("\t");
      const rawPath = rest.join("\t");
      const filePath = normalizeRenamePath(rawPath);
      stats.set(filePath, { additions: added === "-" ? 0 : Number(added), deletions: deleted === "-" ? 0 : Number(deleted), binary: added === "-" || deleted === "-" });
    }
    return nameStatus.split("\n").filter(Boolean).map((line) => {
      const [status, firstPath, secondPath] = line.split("\t");
      const filePath = secondPath || firstPath;
      const previousPath = secondPath ? firstPath : null;
      const stat = stats.get(filePath) || { additions: 0, deletions: 0, binary: false };
      const changeType = stat.binary ? "binary" : status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : status.startsWith("R") ? "renamed" : "modified";
      return { path: filePath, previousPath, changeType, ...stat, riskReasons: classifyRisk(filePath, stat.additions + stat.deletions), sourceStatus: status };
    });
  } catch {
    return run.changedFiles.map((filePath) => ({ path: filePath, previousPath: null, changeType: "modified", additions: 0, deletions: 0, binary: false, riskReasons: classifyRisk(filePath, 0), sourceStatus: "M" }));
  }
}

function normalizeRenamePath(value: string) {
  const brace = value.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`;
  const arrow = value.split(" => ");
  return arrow.length === 2 ? arrow[1] : value;
}

function classifyRisk(filePath: string, lines: number) {
  const reasons: string[] = [];
  if (highRiskPatterns.some((pattern) => pattern.test(filePath))) reasons.push("security, API, migration, configuration, or entry-point path");
  if (lines >= 400) reasons.push("large file-level change");
  return reasons;
}

function rankReviewFiles(files: DiffFile[]) {
  return [...files].sort((left, right) => fileScore(right) - fileScore(left) || left.path.localeCompare(right.path)).slice(0, 3);
}

function fileScore(file: DiffFile) {
  return file.riskReasons.length * 10000 + (/test|spec/i.test(file.path) ? 250 : 0) +
    (file.changeType === "added" || file.changeType === "deleted" ? 500 : 0) + file.additions + file.deletions;
}

function recommendationReason(file: DiffFile) {
  if (file.riskReasons.length) return file.riskReasons.join("; ");
  if (/test|spec/i.test(file.path)) return "verification coverage changed";
  if (file.changeType === "added" || file.changeType === "deleted") return `${file.changeType} file affecting the implementation surface`;
  return `${file.additions + file.deletions} changed line(s), among the largest files in this run`;
}

function summarizeFiles(files: DiffFile[]): CompletionReportRecord["metrics"] {
  return {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    binaryFiles: files.filter((file) => file.binary).length,
    newFiles: files.filter((file) => file.sourceStatus.startsWith("A")).length,
    deletedFiles: files.filter((file) => file.sourceStatus.startsWith("D")).length,
    renamedFiles: files.filter((file) => file.sourceStatus.startsWith("R")).length,
    highRiskFiles: files.filter((file) => file.riskReasons.length > 0).length
  };
}

function buildStructuredReport(task: TaskRecord, run: RunRecord, completionRef: string | null, files: DiffFile[], warning: string | null, completion?: StructuredCompletion) {
  const output = redactCredentialMaterial(run.output || run.error || "No provider summary was returned.");
  const summary = redactCredentialMaterial(completion?.summary || output.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 600) || `Run ${run.status}.`);
  const validations = (["test", "typecheck", "lint", "build"] as const).map((kind) => {
    const mentioned = new RegExp(`\\b${kind}(?:s|check)?\\b`, "i").test(output);
    const skipped = new RegExp(`${kind}[^\\n]{0,40}(not run|skipped|not executed)`, "i").test(output);
    const ran = mentioned && !skipped;
    const failed = ran && new RegExp(`${kind}[^\\n]{0,80}(fail|error|not pass)`, "i").test(output);
    return { kind, ran, passed: ran && !failed, evidence: ran ? (failed ? "Provider reported a failure." : "Provider output reported this verification.") : "Not reported by provider output." };
  });
  const criteria = task.acceptanceCriteria.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
  const acceptanceCriteria = completion?.acceptanceCriteria || (criteria.length ? criteria : ["Task run reached a terminal result."]).map((criterion) => ({
    criterion,
    met: run.status === "completed",
    evidence: run.status === "completed" ? "Run completed; verify the linked diff and validation evidence." : `Run ended with status ${run.status}.`
  }));
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const decisions = completion?.decisions || lines.filter((line) => /^(decision|chose|selected)[:\s]/i.test(line)).slice(0, 8);
  const limitations = completion?.limitations || lines.filter((line) => /^(known limitation|limitation|risk)[:\s]/i.test(line)).slice(0, 8);
  const followUps = completion?.followUps || lines.filter((line) => /^(follow[- ]?up|next step|todo|action item)[:\s]/i.test(line)).slice(0, 8);
  const effectiveValidations = completion?.validations || validations;
  const safeDecisions = decisions.map((item) => redactCredentialMaterial(item));
  const safeLimitations = limitations.map((item) => redactCredentialMaterial(item));
  const safeFollowUps = followUps.map((item) => redactCredentialMaterial(item));
  const metrics = summarizeFiles(files);
  const plainText = [
    "WHAT WAS IMPLEMENTED", summary,
    "", "HOW IT WAS VERIFIED", ...effectiveValidations.map((item) => `- ${item.kind}: ${item.ran ? item.passed ? "reported passed" : "reported failed" : "not reported"}`),
    "", "WHAT TO REVIEW FIRST", ...rankReviewFiles(files).map((file) => `- ${file.path}: ${recommendationReason(file)}`),
    "", "REMAINING RISKS AND FOLLOW-UPS", ...(safeLimitations.length || safeFollowUps.length ? [...safeLimitations, ...safeFollowUps].map((item) => `- ${item}`) : ["- None reported; inspect high-risk files and unmet validation evidence."]),
    warning ? `\nWARNING: ${warning}` : "", completionRef ? `\nCompletion ref: ${completionRef}` : ""
  ].join("\n");
  return {
    summary,
    acceptanceCriteria: sanitizeCompletionRecords(acceptanceCriteria),
    decisions: safeDecisions,
    validations: sanitizeCompletionRecords(effectiveValidations),
    limitations: safeLimitations,
    followUps: safeFollowUps,
    metrics,
    plainText,
    warning
  };
}

function sanitizeCompletionRecords<T>(value: T): T {
  return JSON.parse(redactCredentialMaterial(JSON.stringify(value))) as T;
}

function renderCompletionHtml(task: TaskRecord, report: ReturnType<typeof buildStructuredReport>, files: DiffFile[], revision: number) {
  const recommendations = rankReviewFiles(files);
  const section = (title: string, content: string) => `<section><h2>${escapeHtml(title)}</h2>${content}</section>`;
  const list = (items: string[], fallback: string) => `<ul>${(items.length ? items : [fallback]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width"><title>${escapeHtml(task.title)}</title><style>body{font:14px system-ui;color:#172b4d;margin:0;padding:20px;line-height:1.5}h1{font-size:21px}h2{font-size:15px;margin:0 0 8px}section{border-top:1px solid #dfe1e6;padding:14px 0}li{margin:5px 0}.metric{display:inline-block;margin:0 10px 6px 0;padding:5px 8px;background:#f1f2f4;border-radius:5px}.warn{color:#ae2a19}</style></head><body><h1>${escapeHtml(task.title)} · report r${revision}</h1><p>${escapeHtml(report.summary)}</p><div>${Object.entries(report.metrics).map(([key,value]) => `<span class="metric">${escapeHtml(key)}: ${value}</span>`).join("")}</div>${report.warning ? `<p class="warn">${escapeHtml(report.warning)}</p>` : ""}${section("무엇을 구현했는가", `<p>${escapeHtml(report.summary)}</p>${list(report.decisions, "No explicit implementation decisions were reported.")}`)}${section("어떻게 검증했는가", list(report.validations.map((item) => `${item.kind}: ${item.ran ? item.passed ? "reported passed" : "reported failed" : "not reported"} — ${item.evidence}`), "No validation evidence was reported."))}${section("무엇을 먼저 검토해야 하는가", list(recommendations.map((file) => `${file.path} — ${recommendationReason(file)}`), "No changed files were recorded."))}${section("남은 위험과 후속 작업", list([...report.limitations, ...report.followUps], "None reported; inspect high-risk files and validation gaps."))}</body></html>`;
}

function renderPlainTextFallback(report: CompletionReportRecord) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px system-ui;white-space:pre-wrap;padding:20px}</style></head><body>${escapeHtml(report.plainText)}</body></html>`;
}

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}

function runGit(cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
}

export function completionReportHash(report: CompletionReportRecord) {
  return createHash("sha256").update(report.plainText).digest("hex");
}
