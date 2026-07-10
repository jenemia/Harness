import { randomUUID } from "node:crypto";
import { insertEvent, mapAgent, mapTask, now, openProjectDb } from "./db.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";

export type PlanningMode = "sequential" | "parallel";

export type PlanRequest = {
  goal?: string;
  mode?: PlanningMode;
  autoStart?: boolean;
};

export type PlannedTaskSummary = {
  id: string;
  title: string;
  role: string;
  dependencyTaskIds: string[];
};

export function createPlan(project: ProjectRecord, input: PlanRequest) {
  const goal = input.goal?.trim();
  if (!goal) {
    throw new Error("Planning goal is required.");
  }

  const mode = input.mode || "sequential";
  const db = openProjectDb(project.path);
  try {
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent);
    const planItems = buildPlanItems(goal, mode);
    const inserted: TaskRecord[] = [];

    for (const item of planItems) {
      const dependencies = mode === "sequential" && inserted.length > 0 ? [inserted[inserted.length - 1].id] : [];
      const agent = chooseAgentForRole(agents, item.role);
      const task = insertPlannedTask({
        title: item.title,
        description: item.description,
        role: item.role,
        acceptanceCriteria: item.acceptanceCriteria,
        assigneeAgentId: agent?.id || null,
        dependencyTaskIds: dependencies,
        status: dependencies.length ? "Blocked" : "Selected"
      });
      inserted.push(task);
    }

    const pmAgent = agents.find((agent) => agent.role === "project-manager") || null;
    insertEvent(db, {
      taskId: null,
      agentId: pmAgent?.id || null,
      type: "plan.created",
      message: `PM Agent decomposed a goal into ${inserted.length} tasks.`,
      metadata: {
        goal,
        mode,
        taskIds: inserted.map((task) => task.id)
      }
    });

    return {
      goal,
      mode,
      tasks: inserted.map<PlannedTaskSummary>((task) => ({
        id: task.id,
        title: task.title,
        role: task.labels.find((label) => label.startsWith("role:"))?.replace("role:", "") || "worker",
        dependencyTaskIds: task.dependencyTaskIds
      }))
    };
  } finally {
    db.close();
  }

  function insertPlannedTask(inputTask: {
    title: string;
    description: string;
    role: string;
    acceptanceCriteria: string;
    assigneeAgentId: string | null;
    dependencyTaskIds: string[];
    status: TaskStatus;
  }) {
    const timestamp = now();
    const task: TaskRecord = {
      id: randomUUID(),
      title: inputTask.title,
      description: inputTask.description,
      status: inputTask.status,
      priority: "Medium",
      assigneeAgentId: inputTask.assigneeAgentId,
      reporter: "pm-agent",
      parentTaskId: null,
      dependencyTaskIds: inputTask.dependencyTaskIds,
      labels: ["pm-plan", `role:${inputTask.role}`],
      acceptanceCriteria: inputTask.acceptanceCriteria,
      branchName: null,
      worktreePath: null,
      blockedReason: inputTask.dependencyTaskIds.length
        ? `Waiting on dependencies: ${inputTask.dependencyTaskIds.map((id) => id.slice(0, 8)).join(", ")}`
        : null,
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, labels, acceptance_criteria, branch_name,
        worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigneeAgentId,
      task.reporter,
      task.parentTaskId,
      JSON.stringify(task.dependencyTaskIds),
      JSON.stringify(task.labels),
      task.acceptanceCriteria,
      task.branchName,
      task.worktreePath,
      task.blockedReason,
      task.mergeStatus,
      task.mergeError,
      task.createdAt,
      task.updatedAt
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.created",
      message: `${task.title} was created by PM planning.`,
      metadata: { status: task.status, role: inputTask.role, dependencyTaskIds: task.dependencyTaskIds }
    });

    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id));
  }
}

function buildPlanItems(goal: string, mode: PlanningMode) {
  const explicitItems = parseExplicitItems(goal);
  if (explicitItems.length >= 2) {
    return explicitItems.map((title, index) => ({
      title,
      role: index === explicitItems.length - 1 ? "reviewer" : "programmer",
      description: `Planned from goal:\n\n${goal}`,
      acceptanceCriteria: "The assigned agent reports completion, changed files, and verification notes."
    }));
  }

  const implementationTitle = summarizeGoal(goal);
  const base = [
    {
      title: `Clarify scope: ${implementationTitle}`,
      role: "project-manager",
      description: `Clarify requirements, risks, dependencies, and acceptance criteria for:\n\n${goal}`,
      acceptanceCriteria: "A clear implementation scope and acceptance checklist are recorded."
    },
    {
      title: `Design approach: ${implementationTitle}`,
      role: "project-manager",
      description: `Create a concise technical plan for:\n\n${goal}`,
      acceptanceCriteria: "The technical approach identifies affected files, data model changes, and validation steps."
    },
    {
      title: `Implement: ${implementationTitle}`,
      role: "programmer",
      description: `Implement the planned work for:\n\n${goal}`,
      acceptanceCriteria: "The implementation is complete in the task worktree and relevant checks pass."
    },
    {
      title: `Review and verify: ${implementationTitle}`,
      role: "reviewer",
      description: `Review the implementation for:\n\n${goal}`,
      acceptanceCriteria: "The review records findings, test evidence, and merge readiness."
    }
  ];

  if (mode === "parallel") {
    return base.filter((item) => item.role !== "project-manager").map((item) => ({
      ...item,
      description: `${item.description}\n\nThis task was planned for parallel execution when safe.`
    }));
  }

  return base;
}

function parseExplicitItems(goal: string) {
  return goal
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter((line) => line.length >= 4);
}

function summarizeGoal(goal: string) {
  const firstLine = goal.split(/\r?\n/).find((line) => line.trim())?.trim() || goal.trim();
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function chooseAgentForRole(agents: AgentRecord[], role: string) {
  return (
    agents.find((agent) => agent.role === role) ||
    agents.find((agent) => agent.capabilities.includes(role)) ||
    agents.find((agent) => role === "programmer" && agent.role === "worker") ||
    agents.find((agent) => agent.role !== "project-manager") ||
    null
  );
}

