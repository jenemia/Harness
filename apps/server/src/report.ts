import { now, projectHarnessDir } from "./db.js";
import { createDefaultProviders, resolveProviderCommand } from "./providers.js";
import type { AgentRecord, ProjectHealthReport, ProjectOverview, TaskRecord, TaskStatus } from "./types.js";

const taskStatuses: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Paused", "Blocked", "Done"];
const providers = createDefaultProviders(projectHarnessDir);

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
  const providerCommandIssues = buildProviderCommandIssues(overview);

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
    providerCommandIssues,
    recommendations: buildRecommendations({
      readyTasks,
      blockedTasks: blockedTasks.length,
      pendingApprovals,
      pendingMerges,
      failedRuns,
      runningRuns,
      unassignedTasks,
      busyAgents,
      idleAgents,
      providerCommandIssues
    })
  };
}

function buildProviderCommandIssues(overview: ProjectOverview): ProjectHealthReport["providerCommandIssues"] {
  const agentsById = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const issues = new Map<string, ProjectHealthReport["providerCommandIssues"][number]>();

  for (const agent of overview.agents) {
    collectProviderCommandIssue(issues, overview, agent.modelBackend, agent, null);
  }

  for (const task of overview.tasks) {
    if (task.status === "Done") {
      continue;
    }
    const agent = task.assigneeAgentId ? agentsById.get(task.assigneeAgentId) || null : null;
    const modelBackend = task.modelBackend || agent?.modelBackend || overview.settings.defaultModelBackend;
    collectProviderCommandIssue(issues, overview, modelBackend, agent, task);
  }

  return Array.from(issues.values());
}

function collectProviderCommandIssue(
  issues: Map<string, ProjectHealthReport["providerCommandIssues"][number]>,
  overview: ProjectOverview,
  modelBackend: string,
  agent: AgentRecord | null,
  task: TaskRecord | null
) {
  const provider = providers.llm(modelBackend).definition;
  if (!provider.requiresCommand) {
    return;
  }
  const commandResolution = resolveProviderCommand(providers.platform(), agent || { cliCommand: null }, modelBackend, overview.settings);
  if (commandResolution.command) {
    return;
  }
  const issue = {
    modelBackend,
    providerId: provider.id,
    agentId: agent?.id || null,
    taskId: task?.id || null,
    candidateKeys: commandResolution.candidateKeys
  };
  issues.set(`${issue.modelBackend}:${issue.providerId}:${issue.agentId || "-"}:${issue.taskId || "-"}`, issue);
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
  providerCommandIssues: ProjectHealthReport["providerCommandIssues"];
}) {
  const recommendations: string[] = [];
  if (input.providerCommandIssues.length > 0) {
    const firstIssue = input.providerCommandIssues[0];
    recommendations.push(
      `Configure provider command defaults for ${firstIssue.modelBackend}; try one of: ${firstIssue.candidateKeys.join(", ")}.`
    );
  }
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
