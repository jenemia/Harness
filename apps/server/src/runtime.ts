import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import {
  insertEvent,
  mapAgent,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import type { AgentRecord, ProjectRecord, TaskRecord } from "./types.js";

const runningTasks = new Set<string>();

export async function startTask(project: ProjectRecord, taskId: string) {
  if (runningTasks.has(taskId)) {
    return { accepted: false, reason: "Task is already running." };
  }

  runningTasks.add(taskId);
  void executeTask(project, taskId).finally(() => runningTasks.delete(taskId));
  return { accepted: true };
}

async function executeTask(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  let runId = "";

  try {
    const task = getTask(db, taskId);
    if (!task) {
      return;
    }

    const agent = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : chooseAgent(db, task);
    if (!agent) {
      updateTaskStatus(db, task.id, "Blocked");
      insertEvent(db, {
        taskId: task.id,
        agentId: null,
        type: "task.blocked",
        message: "No available agent could be selected for this task.",
        metadata: {}
      });
      return;
    }

    assignTask(db, task.id, agent.id);
    updateTaskStatus(db, task.id, agent.role === "reviewer" ? "In Review" : "In Progress");
    setAgentBusy(db, agent.id, task.id);

    const workspace = await ensureTaskWorktree(project.path, task);
    const startedAt = now();
    runId = randomUUID();
    db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      runId,
      task.id,
      agent.id,
      "running",
      workspace.branchName,
      workspace.worktreePath,
      null,
      null,
      startedAt,
      null
    );

    db.prepare("UPDATE tasks SET branch_name = ?, worktree_path = ?, updated_at = ? WHERE id = ?").run(
      workspace.branchName,
      workspace.worktreePath,
      now(),
      task.id
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "run.started",
      message: `${agent.name} started work in ${workspace.worktreePath}.`,
      metadata: { branchName: workspace.branchName, worktreePath: workspace.worktreePath }
    });

    const freshTask = getTask(db, task.id) ?? task;
    const result = await runAgentAdapter(agent, freshTask, workspace.worktreePath);
    const completedAt = now();

    db.prepare("UPDATE runs SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?").run(
      result.ok ? "completed" : "failed",
      result.output,
      result.error,
      completedAt,
      runId
    );

    setAgentIdle(db, agent.id);

    if (!result.ok) {
      updateTaskStatus(db, task.id, "Blocked");
      insertEvent(db, {
        taskId: task.id,
        agentId: agent.id,
        type: "run.failed",
        message: result.error || "Agent run failed.",
        metadata: { output: result.output }
      });
      return;
    }

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "run.completed",
      message: `${agent.name} completed the run.`,
      metadata: { output: result.output }
    });

    await autoHandoff(project, db, task.id, agent);
  } catch (error) {
    if (runId) {
      db.prepare("UPDATE runs SET status = ?, error = ?, completed_at = ? WHERE id = ?").run(
        "failed",
        error instanceof Error ? error.message : String(error),
        now(),
        runId
      );
    }

    const task = getTask(db, taskId);
    if (task) {
      updateTaskStatus(db, task.id, "Blocked");
      if (task.assigneeAgentId) {
        setAgentIdle(db, task.assigneeAgentId);
      }
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "run.failed",
        message: error instanceof Error ? error.message : String(error),
        metadata: {}
      });
    }
  } finally {
    db.close();
  }
}

async function autoHandoff(project: ProjectRecord, db: DatabaseSync, taskId: string, completedBy: AgentRecord) {
  const task = getTask(db, taskId);
  if (!task) {
    return;
  }

  if (completedBy.role !== "reviewer") {
    const reviewer = findAgentByRole(db, "reviewer");
    if (reviewer && reviewer.id !== completedBy.id) {
      assignTask(db, task.id, reviewer.id);
      updateTaskStatus(db, task.id, "In Review");
      db.prepare("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)").run(
        randomUUID(),
        task.id,
        completedBy.id,
        reviewer.id,
        "PM auto-handoff: implementation completed and review is required before Done.",
        now()
      );
      insertEvent(db, {
        taskId: task.id,
        agentId: reviewer.id,
        type: "handoff.automatic",
        message: `PM Agent handed the task from ${completedBy.name} to ${reviewer.name}.`,
        metadata: { fromAgentId: completedBy.id, toAgentId: reviewer.id }
      });
      setTimeout(() => {
        void startTask(project, task.id);
      }, 0);
      return;
    }
  }

  updateTaskStatus(db, task.id, "Done");
  insertEvent(db, {
    taskId: task.id,
    agentId: completedBy.id,
    type: "task.done",
    message: "PM Agent marked the task Done after automatic evaluation.",
    metadata: {}
  });
}

async function ensureTaskWorktree(projectPath: string, task: TaskRecord) {
  if (task.worktreePath && task.branchName) {
    return {
      branchName: task.branchName,
      worktreePath: task.worktreePath
    };
  }

  await ensureGitReady(projectPath);

  const safeTitle = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  const branchName = `harness/task-${task.id.slice(0, 8)}-${safeTitle || "work"}`;
  const worktreePath = path.join(projectHarnessDir(projectPath), "worktrees", task.id);
  mkdirSync(path.dirname(worktreePath), { recursive: true });

  const existingWorktree = await runCommand("git", ["worktree", "list", "--porcelain"], projectPath);
  if (!existingWorktree.stdout.includes(worktreePath)) {
    await runCommand("git", ["worktree", "add", "-B", branchName, worktreePath, "HEAD"], projectPath);
  }

  return { branchName, worktreePath };
}

async function ensureGitReady(projectPath: string) {
  const inside = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], projectPath, true);
  if (!inside.ok) {
    await runCommand("git", ["init"], projectPath);
  }

  const hasHead = await runCommand("git", ["rev-parse", "--verify", "HEAD"], projectPath, true);
  if (!hasHead.ok) {
    throw new Error("Git worktree execution requires at least one commit in the project repository.");
  }
}

async function runAgentAdapter(agent: AgentRecord, task: TaskRecord, cwd: string) {
  if (!agent.cliCommand || agent.modelBackend === "mock") {
    const output = [
      `Agent: ${agent.name}`,
      `Role: ${agent.role}`,
      `Task: ${task.title}`,
      "",
      "Mock adapter completed this task. Configure a shell CLI command on the agent to execute a real LLM CLI."
    ].join("\n");
    writeFileSync(
      path.join(cwd, "HARNESS_AGENT_RESULT.md"),
      `# Harness Agent Result\n\n${output}\n`,
      "utf8"
    );
    return { ok: true, output, error: null };
  }

  return runShell(agent.cliCommand, cwd, {
    HARNESS_AGENT_NAME: agent.name,
    HARNESS_AGENT_ROLE: agent.role,
    HARNESS_AGENT_PERSONA: agent.persona,
    HARNESS_TASK_TITLE: task.title,
    HARNESS_TASK_DESCRIPTION: task.description,
    HARNESS_ACCEPTANCE_CRITERIA: task.acceptanceCriteria
  });
}

function getTask(db: DatabaseSync, taskId: string): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return row ? mapTask(row) : null;
}

function getAgent(db: DatabaseSync, agentId: string): AgentRecord | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
  return row ? mapAgent(row) : null;
}

function findAgentByRole(db: DatabaseSync, role: string): AgentRecord | null {
  const row = db.prepare("SELECT * FROM agents WHERE role = ? ORDER BY created_at ASC LIMIT 1").get(role);
  return row ? mapAgent(row) : null;
}

function chooseAgent(db: DatabaseSync, task: TaskRecord): AgentRecord | null {
  const assigned = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : null;
  if (assigned) {
    return assigned;
  }

  const row = db
    .prepare("SELECT * FROM agents WHERE role != ? AND status = ? ORDER BY created_at ASC LIMIT 1")
    .get("project-manager", "idle");
  return row ? mapAgent(row) : null;
}

function assignTask(db: DatabaseSync, taskId: string, agentId: string) {
  db.prepare("UPDATE tasks SET assignee_agent_id = ?, updated_at = ? WHERE id = ?").run(agentId, now(), taskId);
}

function updateTaskStatus(db: DatabaseSync, taskId: string, status: TaskRecord["status"]) {
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), taskId);
}

function setAgentBusy(db: DatabaseSync, agentId: string, taskId: string) {
  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    "busy",
    taskId,
    now(),
    agentId
  );
}

function setAgentIdle(db: DatabaseSync, agentId: string) {
  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    "idle",
    null,
    now(),
    agentId
  );
}

async function runCommand(command: string, args: string[], cwd: string, allowFailure = false) {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  const ok = result.code === 0;
  if (!ok && !allowFailure) {
    throw new Error(result.stderr || `${command} ${args.join(" ")} failed`);
  }

  return { ...result, ok };
}

async function runShell(command: string, cwd: string, extraEnv: Record<string, string>) {
  const result = await new Promise<{ code: number | null; output: string; error: string }>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, ...extraEnv }
    });
    let output = "";
    let error = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, output, error }));
  });

  return {
    ok: result.code === 0,
    output: result.output,
    error: result.error || (result.code === 0 ? null : `Command exited with code ${result.code}`)
  };
}
