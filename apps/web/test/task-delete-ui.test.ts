import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("task detail drawer exposes a confirmed delete action", () => {
  const root = path.resolve(process.cwd());
  const drawer = readFileSync(path.join(root, "src/features/tasks/TaskDetailDrawer.tsx"), "utf8");
  const service = readFileSync(path.join(root, "src/services/taskService.ts"), "utf8");

  assert.match(drawer, /window\.confirm\(t\("task\.deleteConfirm"/);
  assert.match(drawer, /className="delete-button"/);
  assert.match(drawer, /taskService\.remove\(props\.overview\.project\.id, props\.task\.id\)/);
  assert.match(service, /desktopOrHttp\("tasks:delete"/);
  assert.match(service, /method: "DELETE"/);
});

test("board exposes a confirmed completed-task deletion action", () => {
  const root = path.resolve(process.cwd());
  const app = readFileSync(path.join(root, "src/app/AppView.tsx"), "utf8");
  const service = readFileSync(path.join(root, "src/services/taskService.ts"), "utf8");

  assert.match(app, /column === "Done"/);
  assert.match(app, /window\.confirm\(t\("board\.deleteCompletedConfirm"/);
  assert.match(app, /taskService\.removeCompleted/);
  assert.match(service, /desktopOrHttp\("tasks:delete-completed"/);
  assert.match(service, /tasks\/completed/);
});
