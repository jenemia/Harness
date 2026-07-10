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

  const readyTasks = overview.tasks.filter((task) => task.status === "Selected").length;
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
  const schedulerIssues = buildSchedulerIssues(overview);
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
    schedulerIssues,
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
      schedulerIssues,
      providerCommandIssues
    })
  };
}

function buildSchedulerIssues(overview: ProjectOverview): ProjectHealthReport["schedulerIssues"] {
  const tasksById = new Map(overview.tasks.map((task) => [task.id, task]));
  const agentsById = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const agentLoads = new Map<string, number>();
  let projectLoad = 0;

  for (const run of overview.runs) {
    if (run.status !== "running") {
      continue;
    }
    projectLoad += 1;
    agentLoads.set(run.agentId, (agentLoads.get(run.agentId) || 0) + 1);
  }

  const readyTasks = overview.tasks
    .filter((task) => task.status === "Selected")
    .sort((left, right) => left.taskOrder - right.taskOrder || left.createdAt.localeCompare(right.createdAt));
  const workerAgents = overview.agents
    .filter((agent) => agent.role !== "project-manager")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const issues: ProjectHealthReport["schedulerIssues"] = [];

  for (const task of readyTasks) {
    if (projectLoad >= overview.settings.maxProjectParallel) {
      issues.push({
        taskId: task.id,
        title: task.title,
        reason: "Project has reached its parallel run limit."
      });
      continue;
    }

    const dependencyBlocker = getDependencyBlocker(task, tasksById);
    if (dependencyBlocker) {
      issues.push({ taskId: task.id, title: task.title, reason: dependencyBlocker });
      continue;
    }

    const agentResult = chooseSchedulableAgent(task, agentsById, workerAgents, agentLoads);
    if (!agentResult.agent) {
      issues.push({
        taskId: task.id,
        title: task.title,
        reason: agentResult.reason
      });
      continue;
    }

    projectLoad += 1;
    agentLoads.set(agentResult.agent.id, (agentLoads.get(agentResult.agent.id) || 0) + 1);
  }

  return issues;
}

function chooseSchedulableAgent(
  task: TaskRecord,
  agentsById: Map<string, AgentRecord>,
  workerAgents: AgentRecord[],
  agentLoads: Map<string, number>
): { agent: AgentRecord | null; reason: string } {
  if (task.assigneeAgentId) {
    const assigned = agentsById.get(task.assigneeAgentId);
    if (!assigned) {
      return { agent: null, reason: "Assigned agent is missing." };
    }
    if (getAgentLoad(assigned, agentLoads) >= assigned.maxParallel) {
      return { agent: null, reason: "Assigned agent has reached its parallel run limit." };
    }
    return { agent: assigned, reason: "" };
  }

  if (!workerAgents.length) {
    return { agent: null, reason: "No worker agents are available for scheduling." };
  }

  const agent = workerAgents.find((candidate) => getAgentLoad(candidate, agentLoads) < candidate.maxParallel) || null;
  return {
    agent,
    reason: agent ? "" : "No agent has available execution capacity."
  };
}

function getAgentLoad(agent: AgentRecord, agentLoads: Map<string, number>) {
  return agentLoads.get(agent.id) || 0;
}

function getDependencyBlocker(task: TaskRecord, tasksById: Map<string, TaskRecord>) {
  if (!task.dependencyTaskIds.length) {
    return null;
  }

  const waivedIds = new Set(task.waivedDependencyTaskIds);
  const activeDependencyIds = task.dependencyTaskIds.filter((id) => !waivedIds.has(id));
  if (!activeDependencyIds.length) {
    return null;
  }

  const dependencies = activeDependencyIds.map((id) => tasksById.get(id)).filter((dependency): dependency is TaskRecord => Boolean(dependency));
  const doneIds = new Set(dependencies.filter((dependency) => dependency.status === "Done").map((dependency) => dependency.id));
  const missingIds = activeDependencyIds.filter((id) => !tasksById.has(id));
  const blocked = dependencies.filter((dependency) => dependency.status !== "Done");

  if (!missingIds.length && !blocked.length && doneIds.size === activeDependencyIds.length) {
    return null;
  }

  const blockedTitles = blocked.map((dependency) => `${dependency.title} (${dependency.status})`);
  const missing = missingIds.map((id) => `${id.slice(0, 8)} (missing)`);
  return `Waiting on dependencies: ${[...blockedTitles, ...missing].join(", ")}`;
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
  schedulerIssues: ProjectHealthReport["schedulerIssues"];
  providerCommandIssues: ProjectHealthReport["providerCommandIssues"];
}) {
  const recommendations: string[] = [];
  if (input.providerCommandIssues.length > 0) {
    const firstIssue = input.providerCommandIssues[0];
    recommendations.push(
      `Configure provider command defaults for ${firstIssue.modelBackend}; try one of: ${firstIssue.candidateKeys.join(", ")}.`
    );
  }
  if (input.schedulerIssues.length > 0) {
    recommendations.push(
      `Resolve scheduler readiness for ${input.schedulerIssues.length} ready task(s); first blocker: ${input.schedulerIssues[0].reason}`
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
  if (input.readyTasks > 0 && input.idleAgents > 0 && input.pendingApprovals === 0 && input.schedulerIssues.length === 0) {
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
