import type {
  Agent,
  Overview,
  ProviderCatalog,
  Task,
} from "../../api/contracts";
import { statusMessageKey, type MessageKey } from "../../i18n";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function findSchedulerIssues(overview: Overview, t: Translate) {
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
    .sort(
      (left, right) =>
        left.taskOrder - right.taskOrder ||
        left.createdAt.localeCompare(right.createdAt),
    );
  const workerAgents = overview.agents.filter(
    (agent) => agent.role !== "project-manager",
  );
  const issues: Array<{ taskId: string; title: string; reason: string }> = [];

  for (const task of readyTasks) {
    if (projectLoad >= overview.settings.maxProjectParallel) {
      issues.push({
        taskId: task.id,
        title: task.title,
        reason: t("scheduler.projectParallelLimit"),
      });
      continue;
    }

    const dependencyBlocker = getDependencyBlocker(task, tasksById, t);
    if (dependencyBlocker) {
      issues.push({
        taskId: task.id,
        title: task.title,
        reason: dependencyBlocker,
      });
      continue;
    }

    const agentResult = chooseSchedulableAgent(
      task,
      agentsById,
      workerAgents,
      agentLoads,
      t,
    );
    if (!agentResult.agent) {
      issues.push({
        taskId: task.id,
        title: task.title,
        reason: agentResult.reason,
      });
      continue;
    }

    projectLoad += 1;
    agentLoads.set(
      agentResult.agent.id,
      (agentLoads.get(agentResult.agent.id) || 0) + 1,
    );
  }

  return issues;
}

export function chooseSchedulableAgent(
  task: Task,
  agentsById: Map<string, Agent>,
  workerAgents: Agent[],
  agentLoads: Map<string, number>,
  t: Translate,
): { agent: Agent | null; reason: string } {
  if (task.assigneeAgentId) {
    const assigned = agentsById.get(task.assigneeAgentId);
    if (!assigned) {
      return { agent: null, reason: t("scheduler.assignedMissing") };
    }
    if ((agentLoads.get(assigned.id) || 0) >= assigned.maxParallel) {
      return {
        agent: null,
        reason: t("scheduler.assignedParallelLimit"),
      };
    }
    return { agent: assigned, reason: "" };
  }

  if (!workerAgents.length) {
    return {
      agent: null,
      reason: t("scheduler.noWorkerAgents"),
    };
  }

  const agent =
    workerAgents.find(
      (candidate) =>
        (agentLoads.get(candidate.id) || 0) < candidate.maxParallel,
    ) || null;
  return {
    agent,
    reason: agent ? "" : t("scheduler.noAgentCapacity"),
  };
}

export function getDependencyBlocker(
  task: Task,
  tasksById: Map<string, Task>,
  t: Translate,
) {
  if (!task.dependencyTaskIds.length) {
    return null;
  }

  const waivedIds = new Set(task.waivedDependencyTaskIds);
  const activeDependencyIds = task.dependencyTaskIds.filter(
    (id) => !waivedIds.has(id),
  );
  if (!activeDependencyIds.length) {
    return null;
  }

  const dependencies = activeDependencyIds
    .map((id) => tasksById.get(id))
    .filter((dependency): dependency is Task => Boolean(dependency));
  const doneIds = new Set(
    dependencies
      .filter((dependency) => dependency.status === "Done")
      .map((dependency) => dependency.id),
  );
  const missingIds = activeDependencyIds.filter((id) => !tasksById.has(id));
  const blocked = dependencies.filter(
    (dependency) => dependency.status !== "Done",
  );

  if (
    !missingIds.length &&
    !blocked.length &&
    doneIds.size === activeDependencyIds.length
  ) {
    return null;
  }

  const blockedTitles = blocked.map(
    (dependency) =>
      `${dependency.title} (${t(statusMessageKey(dependency.status))})`,
  );
  const missing = missingIds.map((id) =>
    t("scheduler.missingDependency", { id: id.slice(0, 8) }),
  );
  return t("scheduler.waitingDependencies", {
    items: [...blockedTitles, ...missing].join(", "),
  });
}

export function findProviderCommandIssues(
  overview: Overview,
  providerCatalog: ProviderCatalog | null,
) {
  if (!providerCatalog) {
    return [];
  }
  const catalog = providerCatalog;
  const agentsById = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const providersById = new Map(
    catalog.llmProviders.map((provider) => [provider.id, provider]),
  );
  const issues = new Map<
    string,
    {
      modelBackend: string;
      agentId: string | null;
      taskId: string | null;
      candidateKeys: string[];
    }
  >();

  function collect(
    modelBackend: string,
    agent: Agent | null,
    task: Task | null,
  ) {
    const provider = providersById.get(modelBackend);
    if (!provider?.requiresCommand || agent?.cliCommand) {
      return;
    }
    const candidateKeys = catalog.providerCommandKeys.examples.find(
      (example) => example.modelBackend === modelBackend,
    )?.keys || [
      `${catalog.platform.id}.${modelBackend}`,
      `${catalog.platform.platform}.${modelBackend}`,
      modelBackend,
    ];
    const hasCommand = candidateKeys.some((key) =>
      overview.settings.providerCommands[key]?.trim(),
    );
    if (hasCommand) {
      return;
    }
    const issue = {
      modelBackend,
      agentId: agent?.id || null,
      taskId: task?.id || null,
      candidateKeys,
    };
    issues.set(
      `${issue.modelBackend}:${issue.agentId || "-"}:${issue.taskId || "-"}`,
      issue,
    );
  }

  for (const agent of overview.agents) {
    collect(agent.modelBackend, agent, null);
  }
  for (const task of overview.tasks) {
    if (task.status === "Done") {
      continue;
    }
    const agent = task.assigneeAgentId
      ? agentsById.get(task.assigneeAgentId) || null
      : null;
    collect(
      task.modelBackend ||
        agent?.modelBackend ||
        overview.settings.defaultModelBackend,
      agent,
      task,
    );
  }

  return Array.from(issues.values());
}
