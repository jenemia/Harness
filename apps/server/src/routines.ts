import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { insertEvent, mapRoutine, now, openProjectDb } from "./db.js";
import { createTaskService } from "./services.js";
import type { ProjectRecord, RoutineRecord } from "./types.js";

export function createRoutine(project: ProjectRecord, input: Pick<RoutineRecord, "title" | "description" | "intervalMinutes" | "assigneeAgentId" | "catchUpPolicy">) {
  if (!input.title.trim()) throw new Error("Routine title is required.");
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 15) throw new Error("Routine intervals must be at least 15 minutes.");
  const db = openProjectDb(project.path);
  try {
    const timestamp = now(); const id = randomUUID();
    db.prepare("INSERT INTO routines VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)").run(id, input.title.trim(), input.description.trim(), input.intervalMinutes, input.assigneeAgentId, input.catchUpPolicy, timestamp, timestamp);
    return mapRoutine(db.prepare("SELECT * FROM routines WHERE id = ?").get(id));
  } finally { db.close(); }
}

export function materializeDueRoutines(project: ProjectRecord, at = new Date()) {
  const db = openProjectDb(project.path); let due: RoutineRecord[];
  try {
    due = db.prepare("SELECT * FROM routines WHERE enabled = 1").all().map(mapRoutine).filter((routine) => !routine.lastMaterializedAt || at.getTime() >= Date.parse(routine.lastMaterializedAt) + routine.intervalMinutes * 60_000);
    const update = db.prepare("UPDATE routines SET last_materialized_at = ?, updated_at = ? WHERE id = ?");
    for (const routine of due) update.run(at.toISOString(), at.toISOString(), routine.id);
  } finally { db.close(); }
  const tasks = due.map((routine) => createTaskService(project, { title: routine.title, description: routine.description, assigneeAgentId: routine.assigneeAgentId, status: "Backlog", labels: ["routine", `routine:${routine.id}`], autoAssign: false }));
  if (tasks.length) {
    const eventDb = openProjectDb(project.path); try { insertEvent(eventDb, { taskId: null, agentId: null, type: "routine.materialized", message: `Materialized ${tasks.length} routine task(s).`, metadata: { routineIds: due.map((r) => r.id), taskIds: tasks.map((t) => t.id) } }); } finally { eventDb.close(); }
  }
  return { routines: due, tasks };
}
