import assert from "node:assert/strict";
import test from "node:test";
import { getPlanningProviderDefinition, previewPlan } from "../src/planner.js";

test("planning provider advertises structured ticket block support", () => {
  assert.equal(getPlanningProviderDefinition().capabilities.structuredTicketBlocks, true);
});

test("structured ticket blocks preserve fields, roles, and earlier dependencies", () => {
  const preview = previewPlan({
    mode: "parallel",
    goal: `
### T01: Define the product
Role: PM
User story:
- As an owner, I can define the product boundary.
Scope:
- Capture the MVP scope.
Acceptance criteria:
- The scope is reviewable.
UI impact:
- Show the scope in Documents.

### T02: Build the feature
Role: programmer
Depends on: T01
User story:
- As a user, I can use the feature.
Acceptance criteria:
- The feature passes its smoke test.

### T03: Review the feature
Role: QA
Depends on: T01, T02
Acceptance criteria:
- The review records verification notes.
`
  });

  assert.equal(preview.tasks.length, 3);
  assert.deepEqual(
    preview.tasks.map((task) => ({
      title: task.title,
      role: task.role,
      dependencyIndexes: task.dependencyIndexes,
      status: task.status
    })),
    [
      {
        title: "Define the product",
        role: "project-manager",
        dependencyIndexes: [],
        status: "Selected"
      },
      {
        title: "Build the feature",
        role: "programmer",
        dependencyIndexes: [0],
        status: "Blocked"
      },
      {
        title: "Review the feature",
        role: "reviewer",
        dependencyIndexes: [0, 1],
        status: "Blocked"
      }
    ]
  );
  assert.match(preview.tasks[0].description, /## User Story\nAs an owner/);
  assert.match(preview.tasks[0].description, /## Scope\nCapture the MVP scope/);
  assert.match(preview.tasks[0].description, /## UI Impact\nShow the scope in Documents/);
  assert.equal(preview.tasks[1].acceptanceCriteria, "The feature passes its smoke test.");
});

test("structured ticket blocks ignore forward and unknown dependencies", () => {
  const preview = previewPlan({
    mode: "parallel",
    goal: `
### T01: First task
Role: programmer
Depends on: T02, T99
Acceptance criteria:
- The first task is complete.

### T02: Second task
Role: programmer
Acceptance criteria:
- The second task is complete.
`
  });

  assert.deepEqual(preview.tasks[0].dependencyIndexes, []);
  assert.equal(preview.tasks[0].status, "Selected");
});

test("Markdown task lists create simple parallel work items", () => {
  const preview = previewPlan({
    mode: "auto",
    goal: `
# Release checklist

- Build the release candidate
- Run the regression suite
- Update the release notes
`
  });

  assert.equal(preview.effectiveMode, "parallel");
  assert.deepEqual(
    preview.tasks.map((task) => ({ title: task.title, status: task.status })),
    [
      { title: "Build the release candidate", status: "Selected" },
      { title: "Run the regression suite", status: "Selected" },
      { title: "Update the release notes", status: "Selected" }
    ]
  );
});
