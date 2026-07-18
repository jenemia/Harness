import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appView = readFileSync(new URL("../src/app/AppView.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/app/useAppController.ts", import.meta.url), "utf8");

test("lazy feature loading cannot replace the complete application shell", () => {
  assert.doesNotMatch(appView, /<Suspense[^>]*>\s*<div className="app-shell">/);
  assert.match(appView, /<Suspense fallback=\{null\}><TaskDetailDrawer/);
  assert.match(appView, /startTransition\(\(\) => setActiveSection\(section\)\)/);
});

test("the first overview request has a dedicated loading state", () => {
  assert.match(controller, /hasInitializedOverview/);
  assert.match(appView, /!hasInitializedOverview/);
  assert.match(appView, /aria-busy="true"/);
});

test("the board hides internal dashboard support panels", () => {
  assert.doesNotMatch(appView, /board-support-grid/);
  assert.doesNotMatch(
    appView,
    /<(?:ProjectHealthPanel|AttentionPanel|BacklogPanel|ApprovalsPanel|DocumentsPanel|MemoryPanel)\b/,
  );
});
