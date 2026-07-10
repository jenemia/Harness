import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  completionReportHash,
  createInlineReviewComment,
  createReviewFollowUp,
  generateCompletionReport,
  readCompletionReportHtml,
  readRunDiff,
  updateInlineReviewComment,
  updateRunFileReview
} from "../src/completion-reviews.js";
import { getProjectOverview, openProjectDb, updateProjectSettings } from "../src/db.js";
import { startTask } from "../src/runtime.js";
import { createTaskService, registerProjectService } from "../src/services.js";

test("completion reports preserve snapshot diffs, review state, inline comments, and follow-up lineage", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-completion-review-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    mkdirSync(path.join(projectPath, "src"), { recursive: true });
    git(projectPath, ["init", "-b", "main"]);
    git(projectPath, ["config", "user.name", "Harness Test"]);
    git(projectPath, ["config", "user.email", "harness@test.local"]);
    writeFileSync(path.join(projectPath, "src", "index.ts"), "export const value = 1;\n");
    writeFileSync(path.join(projectPath, "old.txt"), "remove me\n");
    writeFileSync(path.join(projectPath, "rename-me.txt"), "rename me\n");
    git(projectPath, ["add", "-A"]);
    git(projectPath, ["commit", "-m", "baseline"]);
    const snapshotRef = git(projectPath, ["rev-parse", "HEAD"]).trim();

    const { project, overview } = registerProjectService({ path: projectPath, seedDefaults: true });
    writeFileSync(path.join(projectPath, ".git", "info", "exclude"), ".harness/\n", { flag: "a" });
    const agent = overview.agents.find((item) => item.role === "programmer") || overview.agents[0];
    assert.ok(agent);
    const task = createTaskService(project, {
      title: "Review completion artifacts",
      description: "Create a reproducible review report.",
      acceptanceCriteria: "Snapshot diff is reproducible; report HTML is sandbox-safe",
      assigneeAgentId: agent.id,
      status: "Done",
      workspaceMode: "worktree"
    });

    writeFileSync(path.join(projectPath, "src", "index.ts"), "export const value = 2;\nexport const enabled = true;\n");
    writeFileSync(path.join(projectPath, "src", "auth.ts"), "export const canAccess = true;\n");
    writeFileSync(path.join(projectPath, "asset.bin"), Buffer.from([0, 1, 2, 3]));
    unlinkSync(path.join(projectPath, "old.txt"));
    git(projectPath, ["mv", "rename-me.txt", "renamed.txt"]);
    git(projectPath, ["add", "-A"]);
    git(projectPath, ["commit", "-m", "implement review changes"]);
    const completionRef = git(projectPath, ["rev-parse", "HEAD"]).trim();

    insertRun(project.path, {
      id: "completed-run",
      taskId: task.id,
      agentId: agent.id,
      status: "completed",
      workspacePath: projectPath,
      snapshotRef,
      output: "Implemented completion review.\nDecision: keep reports local.\nTests passed.\nTypecheck passed.\nBuild passed.\nLint not run.\nKnown limitation: binary content is summarized.\nFollow-up: inspect permissions.",
      changedFiles: ["src/index.ts", "src/auth.ts", "asset.bin", "old.txt", "renamed.txt"]
    });

    updateProjectSettings(project.path, { maxReviewFiles: 2, maxReviewDiffLines: 2, maxReviewBacklog: 1, maxUnreviewedDiffLines: 1, requireCommandApproval: false });
    const report = generateCompletionReport(project, "completed-run");
    assert.equal(report.completionRef, completionRef);
    assert.equal(git(projectPath, ["rev-parse", "refs/harness/runs/completed-run/completion"]).trim(), completionRef);
    assert.equal(report.metrics.files, 5);
    assert.ok(report.metrics.additions > 0 && report.metrics.deletions > 0);
    assert.equal(report.metrics.newFiles, 2);
    assert.equal(report.metrics.deletedFiles, 1);
    assert.equal(report.metrics.renamedFiles, 1);
    assert.equal(report.metrics.binaryFiles, 1);
    assert.ok(report.metrics.highRiskFiles > 0);
    assert.match(report.warning || "", /exceeds/);
    assert.equal(report.validations.find((item) => item.kind === "test")?.passed, true);
    assert.equal(report.validations.find((item) => item.kind === "lint")?.ran, false);
    assert.equal(generateCompletionReport(project, "completed-run").id, report.id);
    assert.equal(completionReportHash(report).length, 64);
    assert.equal(report.htmlHash.length, 64);
    assert.equal(report.mimeType, "text/html");

    const rendered = readCompletionReportHtml(project, "completed-run");
    assert.match(rendered.html, /Content-Security-Policy/);
    assert.match(rendered.html, /무엇을 구현했는가/);
    assert.doesNotMatch(rendered.html, /<script/i);
    assert.ok(report.htmlPath && readFileSync(report.htmlPath, "utf8") === rendered.html);

    const firstDiff = readRunDiff(project, "completed-run", "src/index.ts", { limit: 20 });
    assert.match(firstDiff.diff, /value = 2/);
    writeFileSync(path.join(projectPath, "src", "index.ts"), "unrelated later working tree edit\n");
    assert.equal(readRunDiff(project, "completed-run", "src/index.ts", { limit: 20 }).diff, firstDiff.diff);
    assert.match(readRunDiff(project, "completed-run", "asset.bin").unavailableReason || "", /Binary/);

    let snapshot = getProjectOverview(project);
    const recommended = snapshot.runFileReviews.filter((file) => file.runId === "completed-run" && file.recommendationOrder !== null);
    assert.ok(recommended.length > 0 && recommended.length <= 3);
    const reviewed = updateRunFileReview(project, "completed-run", "src/index.ts", { status: "reviewed", recommendationOrder: 1 });
    assert.equal(reviewed.status, "reviewed");
    assert.ok(reviewed.reviewedAt);

    const comment = createInlineReviewComment(project, "completed-run", { filePath: "src/index.ts", line: 1, side: "new", body: "Cover the disabled branch." });
    assert.equal(comment.status, "open");
    assert.equal(updateInlineReviewComment(project, comment.id, "dismissed").status, "dismissed");
    const followUpComment = createInlineReviewComment(project, "completed-run", { filePath: "src/auth.ts", line: 1, side: "new", body: "Add a denial test." });
    const followUp = createReviewFollowUp(project, "completed-run", [followUpComment.id]);
    assert.ok(followUp.task.labels.includes("review-follow-up"));
    assert.equal(followUp.comments[0].followUpTaskId, followUp.task.id);

    insertRun(project.path, {
      id: "follow-up-run",
      taskId: followUp.task.id,
      agentId: agent.id,
      status: "completed",
      workspacePath: projectPath,
      snapshotRef: completionRef,
      output: "Tests passed. Addressed the selected inline review comment.",
      changedFiles: []
    });
    generateCompletionReport(project, "follow-up-run");
    snapshot = getProjectOverview(project);
    assert.equal(snapshot.inlineReviewComments.find((item) => item.id === followUpComment.id)?.status, "addressed");
    assert.equal(snapshot.inlineReviewComments.find((item) => item.id === followUpComment.id)?.addressedByRunId, "follow-up-run");
    assert.equal(snapshot.completionReports.filter((item) => item.taskId === task.id).length, 1);
    assert.equal(snapshot.completionReports.find((item) => item.runId === "follow-up-run")?.revision, 1);

    insertRun(project.path, {
      id: "revision-run",
      taskId: task.id,
      agentId: agent.id,
      status: "completed",
      workspacePath: projectPath,
      snapshotRef: completionRef,
      output: "Tests passed. Follow-up revision completed.",
      changedFiles: []
    });
    assert.equal(generateCompletionReport(project, "revision-run").revision, 2);

    const failedTask = createTaskService(project, { title: "Review failed changes", status: "Blocked", assigneeAgentId: agent.id, workspaceMode: "worktree" });
    insertRun(project.path, {
      id: "failed-run",
      taskId: failedTask.id,
      agentId: agent.id,
      status: "failed",
      workspacePath: projectPath,
      snapshotRef: completionRef,
      output: "Tests failed after changing src/index.ts.",
      changedFiles: ["src/index.ts"]
    });
    const failedReport = generateCompletionReport(project, "failed-run");
    assert.notEqual(failedReport.completionRef, completionRef);
    assert.ok(getProjectOverview(project).runFileReviews.some((file) => file.runId === "failed-run" && file.path === "src/index.ts"));
    assert.equal(createInlineReviewComment(project, "failed-run", { filePath: "src/index.ts", line: 1, side: "new", body: "Keep the failed attempt reviewable." }).status, "open");

    insertRun(project.path, {
      id: "running-run",
      taskId: task.id,
      agentId: agent.id,
      status: "running",
      workspacePath: projectPath,
      snapshotRef: completionRef,
      output: "",
      changedFiles: []
    });
    assert.throws(() => createInlineReviewComment(project, "running-run", { filePath: "src/index.ts", line: 1, side: "new", body: "Too early" }), /Reviewed run file not found|terminal run/);

    const queued = createTaskService(project, { title: "Should wait for review", status: "Selected", assigneeAgentId: agent.id, workspaceMode: "worktree" });
    const blockedStart = await startTask(project, queued.id);
    assert.equal(blockedStart.accepted, false);
    assert.match(blockedStart.reason || "", /Review backlog limit/);

    const fallbackDb = openProjectDb(project.path);
    fallbackDb.prepare("UPDATE completion_reports SET html_path = ? WHERE id = ?").run(path.join(root, "missing.html"), report.id);
    fallbackDb.close();
    assert.match(readCompletionReportHtml(project, "completed-run").html, /WHAT WAS IMPLEMENTED/);
  } finally {
    process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

function insertRun(projectPath: string, input: {
  id: string;
  taskId: string;
  agentId: string;
  status: "running" | "completed" | "failed";
  workspacePath: string;
  snapshotRef: string;
  output: string;
  changedFiles: string[];
}) {
  const db = openProjectDb(projectPath);
  db.prepare(`
    INSERT INTO runs (
      id, task_id, agent_id, status, branch_name, worktree_path, snapshot_ref,
      model_backend, provider_id, command_preview, output, error, changed_files, started_at, completed_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'mock', 'mock', NULL, ?, NULL, ?, ?, ?)
  `).run(
    input.id, input.taskId, input.agentId, input.status, input.workspacePath, input.snapshotRef,
    input.output, JSON.stringify(input.changedFiles), new Date().toISOString(), input.status === "running" ? null : new Date().toISOString()
  );
  db.close();
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
