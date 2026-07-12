import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { insertEvent, mapAgent, mapRun, mapTaskGoal, now } from "./db.js";
import type { AgentRecord, RunRecord, TaskGoalRecord, TaskRecord } from "./types.js";

export type TaskGoalInput = {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  assigneeAgentId?: string | null;
};

export function listTaskGoals(db: DatabaseSync, taskId: string) {
  return db.prepare("SELECT * FROM task_goals WHERE task_id = ? ORDER BY goal_order ASC").all(taskId).map(mapTaskGoal);
}

export function appendTaskGoals(db: DatabaseSync, task: TaskRecord, inputs: TaskGoalInput[]) {
  const row = db.prepare("SELECT COALESCE(MAX(goal_order), -1) AS max_order FROM task_goals WHERE task_id = ?").get(task.id) as { max_order: number };
  const timestamp = now();
  const insert = db.prepare(`
    INSERT INTO task_goals (
      id, task_id, title, description, acceptance_criteria, assignee_agent_id,
      status, goal_order, completed_run_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?)
  `);
  return inputs.map((input, index) => {
    if (input.assigneeAgentId && !db.prepare("SELECT id FROM agents WHERE id = ? AND archived_at IS NULL").get(input.assigneeAgentId)) {
      throw new Error(`Assignee agent not found: ${input.assigneeAgentId}`);
    }
    const id = randomUUID();
    insert.run(
      id,
      task.id,
      input.title.trim(),
      input.description?.trim() || "",
      input.acceptanceCriteria?.trim() || task.acceptanceCriteria,
      input.assigneeAgentId ?? task.assigneeAgentId,
      Number(row.max_order) + index + 1,
      timestamp,
      timestamp
    );
    return mapTaskGoal(db.prepare("SELECT * FROM task_goals WHERE id = ?").get(id));
  });
}

export function activeTaskGoal(db: DatabaseSync, taskId: string) {
  const row = db.prepare("SELECT * FROM task_goals WHERE task_id = ? AND status = 'active' ORDER BY goal_order LIMIT 1").get(taskId);
  return row ? mapTaskGoal(row) : null;
}

export function activateNextTaskGoal(db: DatabaseSync, taskId: string, completedRunId: string | null) {
  const timestamp = now();
  const active = activeTaskGoal(db, taskId);
  if (active) {
    db.prepare("UPDATE task_goals SET status = 'completed', completed_run_id = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(completedRunId, timestamp, timestamp, active.id);
  }
  const completed = active ? { ...active, completedRunId, completedAt: timestamp, updatedAt: timestamp } : null;
  const nextRow = db.prepare("SELECT * FROM task_goals WHERE task_id = ? AND status = 'queued' ORDER BY goal_order LIMIT 1").get(taskId);
  if (!nextRow) return { completed, next: null };
  const next = mapTaskGoal(nextRow);
  db.prepare("UPDATE task_goals SET status = 'active', started_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, next.id);
  return {
    completed,
    next: { ...next, status: "active" as const, startedAt: timestamp, updatedAt: timestamp }
  };
}

function agentName(db: DatabaseSync, agentId: string | null) {
  if (!agentId) return "미지정";
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
  return row ? mapAgent(row).name : agentId;
}

function latestCompletedRun(db: DatabaseSync, taskId: string, agentId: string | null): RunRecord | null {
  if (!agentId) return null;
  const row = db.prepare("SELECT * FROM runs WHERE task_id = ? AND agent_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1").get(taskId, agentId);
  return row ? mapRun(row) : null;
}

export function recordTaskHandoff(
  db: DatabaseSync,
  task: TaskRecord,
  fromAgentId: string | null,
  toAgentId: string | null,
  options: { reason: string; completedGoal?: TaskGoalRecord | null; nextGoal?: TaskGoalRecord | null; runId?: string | null }
) {
  if (fromAgentId === toAgentId) return;
  const timestamp = now();
  const runRow = options.runId ? db.prepare("SELECT * FROM runs WHERE id = ?").get(options.runId) : null;
  const run = runRow ? mapRun(runRow) : latestCompletedRun(db, task.id, fromAgentId);
  const report = run ? db.prepare("SELECT summary FROM completion_reports WHERE run_id = ? ORDER BY revision DESC LIMIT 1").get(run.id) as { summary?: string } | undefined : undefined;
  const changes = report?.summary?.trim() || (run?.changedFiles.length
    ? `변경 파일: ${run.changedFiles.join(", ")}`
    : "확인된 변경 없음");
  const goal = options.nextGoal
    ? `${options.nextGoal.title}${options.nextGoal.description ? ` — ${options.nextGoal.description}` : ""}`
    : task.description || task.title;
  const acceptance = options.nextGoal?.acceptanceCriteria || task.acceptanceCriteria || "명시된 완료 조건을 충족하고 검증 결과를 보고한다.";
  const body = [
    `담당자 변경: ${agentName(db, fromAgentId)} → ${agentName(db, toAgentId)}`,
    `바뀐 내용: ${changes}`,
    options.completedGoal ? `완료한 목표: ${options.completedGoal.title}` : null,
    `다음 목표: ${goal}`,
    `완료 조건: ${acceptance}`
  ].filter(Boolean).join("\n");
  db.prepare("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), task.id, fromAgentId, toAgentId, options.reason, timestamp);
  const commentId = randomUUID();
  db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").run(commentId, task.id, "system", body, timestamp);
  insertEvent(db, {
    taskId: task.id,
    agentId: toAgentId,
    type: "handoff.recorded",
    message: `Task handed from ${agentName(db, fromAgentId)} to ${agentName(db, toAgentId)}.`,
    metadata: { fromAgentId, toAgentId, commentId, completedGoalId: options.completedGoal?.id || null, nextGoalId: options.nextGoal?.id || null }
  });
}
