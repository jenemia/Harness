import { now } from "./db.js";
import type { ProjectHealthReport, ProjectOverview, TaskStatus } from "./types.js";

const taskStatuses: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Blocked", "Done"];

export function createProjectHealthReport(overview: ProjectOverview): ProjectHealthReport {
  const statusCounts = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as Record<TaskStatus, number>;
  for (const task of overview.tasks) {
    statusCounts[task.status] += 1;
  }

  const readyTasks = overview.tasks.filter((task) => task.status === "Selected" || task.status === "Backlog").length;
  const blockedTasks = overview.tasks
    .filter((task) => task.status === "Blocked")
    .map((task) => ({ id: task.id, title: task.title, reason: task.blockedReason }));
  const pendingApprovals = overview.approvals.filter((approval) => approval.status === "pending").length;
  const pendingMerges = overview.tasks.filter((task) => task.mergeStatus === "pending" || task.mergeStatus === "conflict").length;
  const failedRuns = overview.runs.filter((run) => run.status === "failed").length;
  const runningRuns = overview.runs.filter((run) => run.status === "running").length;
  const unassignedTasks = overview.tasks.filter((task) => task.status !== "Done" && !task.assigneeAgentId).length;
  const busyAgents = overview.agents.filter((agent) => agent.status === "busy").length;
  const idleAgents = overview.agents.filter((agent) => agent.status === "idle").length;

  return {
    projectId: overview.project.id,
    generatedAt: now(),
    statusCounts,
    readyTasks,
    blockedTasks,
    pendingApprovals,
    pendingMerges,
    failedRuns,
    runningRuns,
    unassignedTasks,
    busyAgents,
    idleAgents,
    recommendations: buildRecommendations({
      readyTasks,
      blockedTasks: blockedTasks.length,
      pendingApprovals,
      pendingMerges,
      failedRuns,
      runningRuns,
      unassignedTasks,
      busyAgents,
      idleAgents
    })
  };
}

function buildRecommendations(input: {
  readyTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
  pendingMerges: number;
  failedRuns: number;
  runningRuns: number;
  unassignedTasks: number;
  busyAgents: number;
  idleAgents: number;
}) {
  const recommendations: string[] = [];
  if (input.pendingApprovals > 0) {
    recommendations.push("Review pending approvals so blocked command-backed tasks can resume.");
  }
  if (input.pendingMerges > 0) {
    recommendations.push("Resolve pending or conflicted merges before starting related follow-up work.");
  }
  if (input.blockedTasks > 0) {
    recommendations.push("Inspect blocked tasks and clear dependency, approval, or runtime blockers.");
  }
  if (input.failedRuns > 0) {
    recommendations.push("Review failed runs for timeout, provider, or verification errors.");
  }
  if (input.unassignedTasks > 0) {
    recommendations.push("Assign open tasks to agents so the scheduler can use available capacity.");
  }
  if (input.readyTasks > 0 && input.idleAgents > 0 && input.pendingApprovals === 0) {
    recommendations.push("Run ready tasks to use available idle agent capacity.");
  }
  if (input.runningRuns > 0) {
    recommendations.push("Monitor running tasks for timeout, merge, or handoff follow-up.");
  }
  if (recommendations.length === 0) {
    recommendations.push("No immediate blockers detected.");
  }
  return recommendations;
}
