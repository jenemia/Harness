import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insertEvent, mapAgent, mapRun, mapTask, now, openProjectDb } from "./db.js";
import type { AgentRecord, CodeReviewFindingRecord, CodeReviewJobRecord, ProjectRecord, ReviewSchedule } from "./types.js";

const workerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeProjects = new Set<string>();
const autoreviewPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.agents/skills/autoreview/scripts/autoreview");

type EnqueueInput = { runId: string; taskId: string; sourceAgentId: string; commitSha: string; parentSha: string };
type ReviewFinding = {
  title: string; body: string; priority: "P0" | "P1" | "P2" | "P3"; confidence: number;
  category: CodeReviewFindingRecord["category"]; code_location: { file_path: string; line: number };
};
type ReviewReport = { findings: ReviewFinding[]; overall_correctness: string; overall_explanation: string; overall_confidence: number };

export function enqueueCodeReviewForRun(project: ProjectRecord, input: EnqueueInput) {
  const db = openProjectDb(project.path);
  let queued = true;
  try {
    const reviewerRow = db.prepare(`
      SELECT * FROM agents
      WHERE archived_at IS NULL AND enabled = 1 AND parse_status != 'invalid'
        AND (role = 'code-reviewer' OR capabilities LIKE '%autoreview%')
      ORDER BY CASE WHEN role = 'code-reviewer' THEN 0 ELSE 1 END, created_at
      LIMIT 1
    `).get();
    if (!reviewerRow) return false;
    const reviewer = mapAgent(reviewerRow);
    if (reviewer.reviewSchedule?.enabled === false) return false;
    const existing = db.prepare(`
      SELECT * FROM code_review_jobs
      WHERE task_id = ? AND status = 'findings'
      ORDER BY created_at DESC LIMIT 1
    `).get(input.taskId) as Record<string, unknown> | undefined;
    const timestamp = now();
    if (existing) {
      const cycle = Number(existing.cycle || 0) + 1;
      const result = db.prepare(`
        UPDATE code_review_jobs
        SET head_sha = ?, status = 'queued', cycle = ?, attempt = 0, remediation_run_id = ?,
            session_resumed = 0, session_fallback = 0, started_at = NULL, completed_at = NULL,
            error = NULL, updated_at = ?
        WHERE id = ?
      `).run(input.commitSha, cycle, input.runId, timestamp, String(existing.id));
      insertEvent(db, { taskId: input.taskId, agentId: reviewer.id, type: "code-review.queued", message: `Queued cumulative autoreview cycle ${cycle} for ${input.commitSha.slice(0, 8)}.`, metadata: { jobId: existing.id, commitSha: input.commitSha, cycle } });
    } else {
      const result = db.prepare(`
        INSERT OR IGNORE INTO code_review_jobs (
          id, task_id, source_run_id, source_agent_id, reviewer_agent_id, commit_sha,
          base_sha, head_sha, status, cycle, attempt, report, output, error,
          remediation_goal_id, remediation_run_id, session_resumed, session_fallback,
          started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, ?, ?)
      `).run(randomUUID(), input.taskId, input.runId, input.sourceAgentId, reviewer.id, input.commitSha, input.parentSha, input.commitSha, timestamp, timestamp);
      queued = result.changes > 0;
      if (queued) insertEvent(db, { taskId: input.taskId, agentId: reviewer.id, type: "code-review.queued", message: `Queued autoreview for Harness commit ${input.commitSha.slice(0, 8)}.`, metadata: { commitSha: input.commitSha, sourceRunId: input.runId } });
    }
  } finally {
    db.close();
  }
  if (queued) scheduleReviewPump(project, 10);
  return queued;
}

export function startCodeReviewRuntime(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    db.prepare("UPDATE code_review_jobs SET status = 'queued', started_at = NULL, updated_at = ? WHERE status = 'running'").run(now());
  } finally { db.close(); }
  scheduleReviewPump(project, 50);
}

export function listCodeReviews(project: ProjectRecord, taskId?: string) {
  const db = openProjectDb(project.path);
  try {
    const jobs = (taskId
      ? db.prepare("SELECT * FROM code_review_jobs WHERE task_id = ? ORDER BY created_at DESC").all(taskId)
      : db.prepare("SELECT * FROM code_review_jobs ORDER BY created_at DESC").all()).map(mapCodeReviewJob);
    const findings = (taskId
      ? db.prepare("SELECT * FROM code_review_findings WHERE task_id = ? ORDER BY created_at").all(taskId)
      : db.prepare("SELECT * FROM code_review_findings ORDER BY created_at").all()).map(mapCodeReviewFinding);
    return { jobs, findings };
  } finally { db.close(); }
}

export function retryCodeReview(project: ProjectRecord, jobId: string) {
  const db = openProjectDb(project.path);
  try {
    const result = db.prepare("UPDATE code_review_jobs SET status = 'queued', attempt = 0, error = NULL, started_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'blocked')").run(now(), jobId);
    if (!result.changes) throw new Error("Failed or blocked code review job not found.");
  } finally { db.close(); }
  scheduleReviewPump(project, 10);
  return { queued: true, jobId };
}

export function updateCodeReviewFinding(project: ProjectRecord, findingId: string, status: "addressed" | "dismissed", reason?: string) {
  if (status === "dismissed" && !reason?.trim()) throw new Error("A dismissal reason is required.");
  const db = openProjectDb(project.path);
  try {
    const finding = db.prepare("SELECT * FROM code_review_findings WHERE id = ?").get(findingId) as Record<string, unknown> | undefined;
    if (!finding) throw new Error("Code review finding not found.");
    db.prepare("UPDATE code_review_findings SET status = ?, dismissal_reason = ?, updated_at = ? WHERE id = ?").run(status, status === "dismissed" ? reason!.trim() : null, now(), findingId);
    const inlineCommentId = typeof finding.inline_comment_id === "string" ? finding.inline_comment_id : null;
    if (inlineCommentId) db.prepare("UPDATE inline_review_comments SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), inlineCommentId);
    return mapCodeReviewFinding(db.prepare("SELECT * FROM code_review_findings WHERE id = ?").get(findingId));
  } finally { db.close(); }
}

function scheduleReviewPump(project: ProjectRecord, delay: number) {
  if (workerTimers.has(project.id)) return;
  const timer = setTimeout(() => {
    workerTimers.delete(project.id);
    void pumpReviews(project);
  }, delay);
  timer.unref?.();
  workerTimers.set(project.id, timer);
}

async function pumpReviews(project: ProjectRecord) {
  if (activeProjects.has(project.id)) return;
  activeProjects.add(project.id);
  try {
    while (true) {
      const job = claimNextJob(project);
      if (!job) break;
      await runReviewJob(project, job);
    }
  } finally {
    activeProjects.delete(project.id);
    scheduleReviewPump(project, 60_000);
  }
}

function claimNextJob(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    const rows = db.prepare(`
      SELECT j.*, a.review_schedule
      FROM code_review_jobs j JOIN agents a ON a.id = j.reviewer_agent_id
      WHERE j.status = 'queued' ORDER BY j.created_at
    `).all() as Array<Record<string, unknown>>;
    const row = rows.find((candidate) => scheduleIsDue(parseSchedule(candidate.review_schedule), String(candidate.created_at)));
    if (!row) return null;
    const running = db.prepare("SELECT COUNT(*) AS count FROM code_review_jobs WHERE reviewer_agent_id = ? AND status = 'running'").get(String(row.reviewer_agent_id)) as { count: number };
    const reviewer = mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(String(row.reviewer_agent_id)));
    if (running.count >= reviewer.maxParallel) return null;
    const result = db.prepare("UPDATE code_review_jobs SET status = 'running', attempt = attempt + 1, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(now(), now(), String(row.id));
    return result.changes ? mapCodeReviewJob(db.prepare("SELECT * FROM code_review_jobs WHERE id = ?").get(String(row.id))) : null;
  } finally { db.close(); }
}

async function runReviewJob(project: ProjectRecord, job: CodeReviewJobRecord) {
  const db = openProjectDb(project.path);
  let workspace = "";
  let reviewer: AgentRecord;
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(job.sourceRunId);
    const reviewerRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(job.reviewerAgentId);
    if (!runRow || !reviewerRow) throw new Error("Code review provenance is unavailable.");
    workspace = mapRun(runRow).worktreePath || "";
    reviewer = mapAgent(reviewerRow);
    if (!workspace) throw new Error("Code review worktree is unavailable.");
  } catch (error) {
    db.close();
    return failJob(project, job, error instanceof Error ? error.message : String(error));
  }
  db.close();

  const temporary = mkdtempSync(path.join(tmpdir(), "harness-autoreview-"));
  const jsonPath = path.join(temporary, "report.json");
  const args = job.cycle === 0
    ? ["--mode", "commit", "--commit", job.commitSha]
    : ["--mode", "branch", "--base", job.baseSha];
  args.push(...reviewerArgs(reviewer), "--json-output", jsonPath);
  try {
    const result = await runProcess(autoreviewPath, args, workspace, 30 * 60_000);
    let report: ReviewReport;
    try { report = validateReport(JSON.parse(readFileSync(jsonPath, "utf8"))); }
    catch (error) { return failJob(project, job, `Autoreview did not produce valid JSON: ${error instanceof Error ? error.message : String(error)}\n${result.stderr}`); }
    return report.findings.length ? handleFindings(project, job, report, result.stdout) : handleClean(project, job, report, result.stdout);
  } catch (error) {
    return failJob(project, job, error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function handleFindings(project: ProjectRecord, job: CodeReviewJobRecord, report: ReviewReport, output: string) {
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    db.prepare("UPDATE code_review_jobs SET status = ?, report = ?, output = ?, error = NULL, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(job.cycle >= 2 ? "blocked" : "findings", JSON.stringify(report), output, timestamp, timestamp, job.id);
    db.prepare("UPDATE code_review_findings SET status = 'addressed', addressed_by_run_id = ?, updated_at = ? WHERE job_id = ? AND status = 'open'")
      .run(job.remediationRunId, timestamp, job.id);
    const sourceRun = mapRun(db.prepare("SELECT * FROM runs WHERE id = ?").get(job.sourceRunId));
    for (const finding of report.findings) {
      const findingId = randomUUID();
      const commentId = randomUUID();
      db.prepare(`INSERT INTO inline_review_comments (
        id, run_id, task_id, file_path, line, side, snapshot_ref, completion_ref, body,
        status, follow_up_task_id, addressed_by_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, 'open', NULL, NULL, ?, ?)`)
        .run(commentId, job.sourceRunId, job.taskId, finding.code_location.file_path, finding.code_location.line, sourceRun.snapshotRef, job.headSha, `[${finding.priority}] ${finding.title}\n\n${finding.body}`, timestamp, timestamp);
      db.prepare(`INSERT INTO code_review_findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, NULL, ?, ?)`)
        .run(findingId, job.id, job.taskId, finding.title, finding.body, finding.priority, finding.confidence, finding.category, finding.code_location.file_path, finding.code_location.line, commentId, timestamp, timestamp);
    }
    if (job.cycle >= 2) {
      db.prepare("UPDATE tasks SET status = 'Blocked', blocked_reason = ?, updated_at = ? WHERE id = ?").run("Autoreview did not converge after two remediation cycles.", timestamp, job.taskId);
      insertEvent(db, { taskId: job.taskId, agentId: job.reviewerAgentId, type: "code-review.blocked", message: "Autoreview stopped after two non-converging remediation cycles.", metadata: { jobId: job.id, cycle: job.cycle, findings: report.findings.length } });
      return;
    }
    const task = mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(job.taskId));
    let remediationGoalId = job.remediationGoalId;
    if (!remediationGoalId) {
      const active = db.prepare("SELECT goal_order FROM task_goals WHERE task_id = ? AND status = 'active' ORDER BY goal_order LIMIT 1").get(task.id) as { goal_order: number } | undefined;
      const goalOrder = active ? Number(active.goal_order) + 1 : 0;
      db.prepare("UPDATE task_goals SET goal_order = goal_order + 1, updated_at = ? WHERE task_id = ? AND goal_order >= ?").run(timestamp, task.id, goalOrder);
      remediationGoalId = randomUUID();
      db.prepare(`INSERT INTO task_goals (
        id, task_id, title, description, acceptance_criteria, assignee_agent_id,
        status, goal_order, completed_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?)`)
        .run(remediationGoalId, task.id, `Address autoreview for ${job.commitSha.slice(0, 8)}`,
          report.findings.map((finding) => `- [${finding.priority}] ${finding.code_location.file_path}:${finding.code_location.line} ${finding.title}\n  ${finding.body}`).join("\n"),
          "Address every actionable autoreview finding and commit verified fixes.", job.sourceAgentId, goalOrder, timestamp, timestamp);
      db.prepare("UPDATE code_review_jobs SET remediation_goal_id = ?, updated_at = ? WHERE id = ?").run(remediationGoalId, timestamp, job.id);
    }
    db.prepare("INSERT INTO comments VALUES (?, ?, 'autoreview', ?, ?)").run(randomUUID(), job.taskId, `Autoreview job ${job.id}\n${report.findings.map((finding) => `- [${finding.priority}] ${finding.code_location.file_path}:${finding.code_location.line} ${finding.title}: ${finding.body}`).join("\n")}`, timestamp);
    db.prepare("UPDATE tasks SET status = 'Selected', assignee_agent_id = ?, blocked_reason = NULL, updated_at = ? WHERE id = ?").run(job.sourceAgentId, timestamp, job.taskId);
    insertEvent(db, { taskId: job.taskId, agentId: job.sourceAgentId, type: "code-review.findings", message: `Autoreview found ${report.findings.length} actionable issue(s); resuming the originating agent.`, metadata: { jobId: job.id, sourceRunId: job.sourceRunId, findings: report.findings.length } });
  } finally { db.close(); }
  void import("./runtime.js").then(({ startTask }) => startTask(project, job.taskId));
}

function handleClean(project: ProjectRecord, job: CodeReviewJobRecord, report: ReviewReport, output: string) {
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    db.prepare("UPDATE code_review_jobs SET status = 'clean', report = ?, output = ?, error = NULL, completed_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(report), output, timestamp, timestamp, job.id);
    db.prepare("UPDATE code_review_findings SET status = 'addressed', addressed_by_run_id = ?, updated_at = ? WHERE job_id = ? AND status = 'open'").run(job.remediationRunId, timestamp, job.id);
    if (job.remediationGoalId) db.prepare("UPDATE task_goals SET status = 'completed', completed_run_id = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(job.remediationRunId, timestamp, timestamp, job.remediationGoalId);
    insertEvent(db, { taskId: job.taskId, agentId: job.reviewerAgentId, type: "code-review.clean", message: `Autoreview is clean for ${job.headSha.slice(0, 8)}.`, metadata: { jobId: job.id, cycle: job.cycle } });
  } finally { db.close(); }
  void import("./runtime.js").then(({ finalizeReviewedTask }) => finalizeReviewedTask(project, job.taskId, job.sourceAgentId));
}

function failJob(project: ProjectRecord, job: CodeReviewJobRecord, message: string) {
  const db = openProjectDb(project.path);
  try {
    const retry = job.attempt < 3;
    db.prepare("UPDATE code_review_jobs SET status = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(retry ? "queued" : "failed", message.slice(0, 8000), retry ? null : now(), now(), job.id);
    if (!retry) db.prepare("UPDATE tasks SET status = 'Blocked', blocked_reason = ?, updated_at = ? WHERE id = ?").run("Automatic code review failed after three attempts.", now(), job.taskId);
    insertEvent(db, { taskId: job.taskId, agentId: job.reviewerAgentId, type: retry ? "code-review.retry" : "code-review.failed", message: retry ? `Autoreview attempt ${job.attempt} failed and will retry.` : "Autoreview failed after three attempts.", metadata: { jobId: job.id, error: message.slice(0, 1000) } });
  } finally { db.close(); }
  if (job.attempt < 3) scheduleReviewPump(project, job.attempt * 30_000);
}

function reviewerArgs(agent: AgentRecord) {
  if (agent.modelBackend === "claude") return ["--engine", "claude"];
  const models: Record<string, string> = { "codex-5.5": "gpt-5.5", "codex-5.6-sol": "gpt-5.6-sol", "codex-5.6-terra": "gpt-5.6-terra", "codex-5.6-luna": "gpt-5.6-luna" };
  return ["--engine", "codex", ...(models[agent.modelBackend] ? ["--model", models[agent.modelBackend]] : [])];
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Autoreview timed out after 30 minutes.")); }, timeoutMs);
    child.once("error", reject);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function validateReport(value: unknown): ReviewReport {
  if (!value || typeof value !== "object" || !Array.isArray((value as ReviewReport).findings)) throw new Error("findings must be an array");
  const report = value as ReviewReport;
  for (const finding of report.findings) {
    if (!finding.title || !finding.body || !finding.code_location?.file_path || !Number.isInteger(finding.code_location.line)) throw new Error("finding is incomplete");
  }
  return report;
}

function parseSchedule(value: unknown): ReviewSchedule {
  try { return value ? JSON.parse(String(value)) : { enabled: true, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null }; }
  catch { return { enabled: true, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null }; }
}

export function scheduleIsDue(schedule: ReviewSchedule, createdAt: string, date = new Date()) {
  if (!schedule.enabled) return false;
  if (schedule.trigger === "on-commit") return true;
  if (schedule.trigger === "interval") return date.getTime() >= Date.parse(createdAt) + Number(schedule.intervalMinutes || 15) * 60_000;
  if (!schedule.dailyAt || !schedule.timezone) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("hour")}:${part("minute")}` >= schedule.dailyAt;
}

export function mapCodeReviewJob(row: unknown): CodeReviewJobRecord {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id), taskId: String(r.task_id), sourceRunId: String(r.source_run_id), sourceAgentId: String(r.source_agent_id), reviewerAgentId: String(r.reviewer_agent_id),
    commitSha: String(r.commit_sha), baseSha: String(r.base_sha), headSha: String(r.head_sha), status: String(r.status) as CodeReviewJobRecord["status"], cycle: Number(r.cycle), attempt: Number(r.attempt),
    report: r.report ? JSON.parse(String(r.report)) : null, output: r.output ? String(r.output) : null, error: r.error ? String(r.error) : null,
    remediationGoalId: r.remediation_goal_id ? String(r.remediation_goal_id) : null, remediationRunId: r.remediation_run_id ? String(r.remediation_run_id) : null,
    sessionResumed: Number(r.session_resumed || 0) !== 0, sessionFallback: Number(r.session_fallback || 0) !== 0,
    startedAt: r.started_at ? String(r.started_at) : null, completedAt: r.completed_at ? String(r.completed_at) : null, createdAt: String(r.created_at), updatedAt: String(r.updated_at)
  };
}

export function mapCodeReviewFinding(row: unknown): CodeReviewFindingRecord {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id), jobId: String(r.job_id), taskId: String(r.task_id), title: String(r.title), body: String(r.body), priority: String(r.priority) as CodeReviewFindingRecord["priority"],
    confidence: Number(r.confidence), category: String(r.category) as CodeReviewFindingRecord["category"], filePath: String(r.file_path), line: Number(r.line), status: String(r.status) as CodeReviewFindingRecord["status"],
    dismissalReason: r.dismissal_reason ? String(r.dismissal_reason) : null, inlineCommentId: r.inline_comment_id ? String(r.inline_comment_id) : null, addressedByRunId: r.addressed_by_run_id ? String(r.addressed_by_run_id) : null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at)
  };
}
