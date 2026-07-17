import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { updateProjectSettings } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { startTask } from "../src/runtime.js";
import { createTaskService, registerProjectService } from "../src/services.js";

test("automatic work starts with PM and hands through programmer and reviewer while work stays in progress", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-pm-workflow-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project, overview } = registerProjectService({ path: path.join(root, "project"), seedDefaults: true });
    updateProjectSettings(project.path, { requireCommandApproval: false });
    const pm = overview.agents.find((agent) => agent.role === "project-manager");
    const programmer = overview.agents.find((agent) => agent.role === "programmer");
    const reviewer = overview.agents.find((agent) => agent.role === "reviewer");
    assert.ok(pm && programmer && reviewer);

    const task = createTaskService(project, {
      title: "Implement through the PM workflow",
      assigneeAgentId: programmer.id,
      status: "Backlog",
      workspaceMode: "harness"
    });
    assert.equal(task.assigneeAgentId, pm.id);

    assert.equal((await startTask(project, task.id)).accepted, true);
    const completed = await waitForOverview(project, (value) =>
      value.tasks.some((item) => item.id === task.id && item.status === "Development Complete")
    );
    const runs = completed.runs.filter((run) => run.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    assert.deepEqual(runs.map((run) => run.agentId), [pm.id, programmer.id, reviewer.id]);
    assert.deepEqual(completed.handoffs.filter((handoff) => handoff.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((handoff) => [handoff.fromAgentId, handoff.toAgentId]), [
      [pm.id, programmer.id],
      [programmer.id, reviewer.id]
    ]);
    assert.ok(completed.events.filter((event) => event.taskId === task.id && event.type === "run.started").every((event) =>
      !String(event.message).includes("In Review")
    ));
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForOverview(
  project: { id: string; name: string; path: string; createdAt: string; updatedAt: string },
  predicate: (overview: ReturnType<typeof getProjectOverview>) => boolean
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const overview = getProjectOverview(project);
    if (predicate(overview)) return overview;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for PM workflow.");
}
