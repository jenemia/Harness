# Harness Service Plan

## 1. Product Vision

Harness is a local-first multi-agent project management framework where users can create projects, define AI agents with distinct personas, assign work through a Jira-like Kanban board, and track what each agent is doing over time.

The product should feel less like a chat app and more like an operational workspace: a project dashboard where human users, project manager agents, and worker agents share the same task board, history, and project context.

## 2. Reference Direction

Primary reference: NousResearch Hermes Agent.

Observed reference ideas:

- Durable Kanban board shared by multiple named agents.
- Each task is persisted rather than living only inside a chat session.
- Agents can collaborate through handoffs and shared state.
- Workers can run with their own identity and execution context.
- The board acts as the source of truth for planning, execution, review, and tracking.

Harness should borrow the durable multi-agent Kanban concept, but focus on a local project workspace with an approachable Jira-like UI and model/CLI extensibility.

## 3. Target Users

- Solo developers managing multiple local projects.
- Small teams experimenting with AI-assisted development workflows.
- Users who want several AI agents to perform specialized roles under a project manager agent.
- Users who prefer local execution and folder-based project organization instead of a cloud-only SaaS.
- Users who want real task execution, not only task planning or static issue tracking.

## 4. Core Concepts

### Project

A project maps to a local folder. Each project owns its board, agents, settings, linked repository path, documents, and execution history.

Expected examples:

- `/Users/sean/Documents/harness-projects/app-a`
- `/Users/sean/Documents/harness-projects/game-b`
- `/Users/sean/Documents/harness-projects/research-c`

Project-local data should live inside the project folder so the project can be moved, backed up, inspected, or versioned as a self-contained workspace.

Initial implementation: the project sidebar shows per-project summary counts for total tasks, blocked tasks, running tasks, pending approvals, pending merges, and busy agents so users can scan multiple local projects quickly.

Initial implementation: each project also exposes a health report through the UI, API, and CLI. The report summarizes status counts, ready work, blockers, pending approvals, pending merges, failed/running runs, unassigned work, busy/idle agents, and recommended next actions.

Initial implementation: projects can be unregistered from the global Harness project list through the UI, API, or CLI without deleting the project folder or project-local `.harness` data.

Initial implementation: project lists include local folder and project database availability so moved or missing folders are visible without recreating missing `.harness` data during a read-only list operation.

Initial implementation: project registry entries can be renamed or re-linked to a moved folder through the UI, API, or CLI without creating a new folder.

Initial implementation: the global project root can be scanned from the UI, API, or CLI to import existing Harness folders and Git repositories as projects. Plain folders are excluded by default and can be included explicitly when the user wants to initialize them as Harness projects.

### Agent

An agent is a named worker profile with a persona, role, model configuration, tool permissions, and execution policy.

Basic agent fields:

- Name
- Persona prompt
- Role
- Preferred model or CLI backend
- Available tools
- Working directory scope
- Task limits
- Review requirements

### Project Manager Agent

The project manager agent decomposes work, assigns tasks, monitors progress, detects blockers, asks the human for decisions, and can route work to specialized agents.

The PM agent does not need to perform all work directly. Its primary job is orchestration.

The PM agent decides whether work can run in parallel or must proceed sequentially. When a task completes, the PM agent evaluates the result and chooses the next best agent or human handoff.

Initial implementation: the PM planning endpoint can decompose a user goal into scoped Kanban tasks, assign them by agent role, and create sequential dependencies for planned handoff chains.

### Task

A task is the durable unit of work shown on the Kanban board.

Basic task fields:

- Title
- Description
- Status
- Priority
- Assignee agent
- Reporter
- Parent task
- Subtasks
- Labels
- Project
- Linked files
- Acceptance criteria
- Execution log
- Review state
- Created/updated timestamps

### Handoff

A handoff records that one agent passed context, work, or a question to another agent. Handoffs should be first-class history, not hidden chat text.

Handoffs can be automatic, PM-driven, or human-approved depending on the project policy and task risk.

Decision: PM-driven handoffs should run automatically by default.

Default handoff policy:

- When an agent completes a task, the PM agent evaluates the output.
- The PM agent chooses the next best agent, status, or follow-up task automatically.
- The PM agent records the reason for each handoff.
- Human approval is only required when a handoff crosses a configured risk boundary.

Initial implementation: project settings include role-to-role handoff rules. By default, programmer and worker completions route to a reviewer; roles without a matching rule move to Done after successful completion.

Initial implementation: after each successful run, the PM runtime inspects the latest completion output and changed files before choosing the role-to-role handoff or Done transition. It records a `pm.evaluated` timeline event with output excerpt, changed files, detected follow-up/risk/verification signals, and includes the evaluation summary in automatic handoff metadata.

Initial implementation: shell-backed LLM providers create a command execution approval request before any configured CLI command runs. The task is blocked until the user approves or rejects the request from the Approvals panel. Approved tasks resume automatically; rejected tasks remain blocked and the decision is recorded in the timeline.

Initial implementation: completed task worktree changes create merge approval requests in the same approval queue. Approving a merge request merges the task branch into the main checkout; rejecting it sends the task back to Selected with requested changes recorded in the timeline.

Initial implementation: the local policy provider detects risky shell commands and forces a command approval request even when project-wide command approvals are disabled. The first risk rules cover recursive forced deletes, hard Git resets, Git clean, Git push, sudo, package install/update commands, and remote scripts piped into a shell.

Initial implementation: task run output can be converted into follow-up Kanban tasks from the task detail run list. Follow-ups are created as child tasks with a dependency on the source task so PM output can become tracked work.

Risk boundaries can include:

- Merging code back to the main project branch.
- Running shell-backed LLM CLI commands.
- Running destructive commands.
- Installing or upgrading dependencies.
- Editing files outside the task worktree.
- Changing project-level settings.
- Marking a milestone or release task complete.

## 5. Initial Feature Requirements

1. Multiple agents can be created by entering personas.
2. A project manager agent can assign work to multiple agents.
3. Kanban tasks show which agent is currently working on them.
4. Initial UI should imitate Jira's information architecture and board workflow.
5. The app must be installable and runnable locally.
6. The app should support multiple LLM CLI backends.
7. Users can organize projects by folder and view work per project.
8. Agents should be able to execute assigned work, not only describe plans.
9. Multiple agents should be able to work in parallel when dependencies allow it.
10. Sequential workflows should be supported for cases such as planning -> implementation -> review.

## 6. Suggested Additional Features

### Agent Capability Profiles

Each agent should have declared strengths, allowed tools, and boundaries. This lets the PM agent choose agents more intelligently than simple round-robin assignment.

Initial implementation: agents and agent templates store allowed tool tags and written boundaries in addition to capabilities. These fields can be edited in the UI or CLI and are injected into each agent prompt and CLI environment so model-specific runners receive the same operating limits.

Examples:

- Frontend Engineer
- Backend Engineer
- QA Reviewer
- Product Planner
- Documentation Writer
- Refactor Specialist

### Task Decomposition

A user or PM agent can turn a large task into a tree of subtasks. Child tasks should remain blocked until dependencies are ready.

The PM agent should decide which subtasks are independent enough to run in parallel and which ones must wait for prior output.

Initial implementation: any task can be decomposed into child tasks from the task detail drawer, API, or headless CLI. Parallel decomposition creates ready child tasks with the source task as parent. Sequential decomposition creates a child chain where each downstream child depends on the previous child and starts blocked with a dependency reason.

### Dependency And Blocker Tracking

Tasks should support dependencies, blockers, and blocked reasons. The board should make blocked work visually obvious.

Dependency tracking is required for safe parallelism. A task should not become executable until its required predecessors are done or explicitly waived by the user/PM agent.

Initial implementation: tasks store explicit waived dependency ids. Waived dependencies stay visible in task detail and CLI output, but the scheduler excludes them from readiness blockers so a user or PM decision can unblock work without deleting dependency history.

### Execution Timeline

Each task should keep a structured timeline:

- Assignment
- Agent start
- Agent notes
- Tool commands
- Files touched
- Review result
- Human decision
- Completion

The timeline should show both individual agent actions and PM orchestration decisions.

### Human Approval Gates

Certain actions should require user approval:

- Running shell-backed LLM CLI commands
- Running destructive shell commands
- Editing files outside the project folder
- Installing packages
- Pushing to remote repositories
- Creating large numbers of tasks
- Marking project milestones complete

Initial implementation: command-backed LLM providers still honor project-level command approval settings, but risky shell command detection is enforced by the policy provider independently of that setting. Risk tags and command previews are recorded in task events and approval request metadata.

### Review Agent

A dedicated review agent can inspect completed work before the task moves to Done. This keeps PM orchestration and quality control separate.

### Agent Memory

Agents should remember project-specific conventions, decisions, recurring mistakes, and user preferences. Memory should be scoped by project unless explicitly promoted globally.

Initial implementation: project-local memory entries can be created and edited from the UI, stored in the project `.harness` database, and injected into every agent run through the generated prompt file plus `HARNESS_PROJECT_MEMORY` and `HARNESS_PROJECT_MEMORY_FILE`.

Initial implementation: project memory can also be listed, created, and updated through the headless CLI so automation scripts can maintain conventions and preferences before scheduling agent work.

Initial implementation: global memory entries can be created and edited from the Memory panel, API, or headless CLI. Global memory is stored in the app-wide Harness database and injected into every agent run through `.harness/global-memory.md`, `HARNESS_GLOBAL_MEMORY`, and `HARNESS_GLOBAL_MEMORY_FILE`, while project memory remains in the project-local database.

### Model Router

Harness should route tasks to different models or CLI tools based on cost, quality, speed, and task type.

Example backends:

- OpenAI-compatible CLI
- Claude Code CLI
- Gemini CLI
- Ollama
- LM Studio
- OpenRouter-compatible command wrapper

The router should support project defaults, agent-specific defaults, and per-task overrides.

Initial implementation: tasks can optionally override the agent's model backend. Runtime approval checks, provider selection, prompt environment, and project provider command lookup use the task override when present.

### Local Audit Log

Every agent action should be auditable. Users should be able to answer: who did what, when, why, and with which model.

Initial implementation: every run stores the assigned agent, effective model backend, provider id, command preview when applicable, workspace path, branch when present, snapshot ref, changed files, output, error, and timestamps. Task detail and timeline views expose this audit trail.

Initial implementation: run audit trails can also be inspected from the headless CLI with status/task/agent/provider/model filters and run-scoped detail output.

### Workspace Snapshots

Before an agent starts risky work, Harness can create a lightweight snapshot such as a Git branch, stash, patch file, or checkpoint record.

Initial implementation: every run records a starting snapshot reference before the agent provider executes. Git worktree tasks store the starting Git `HEAD`; Harness workspace tasks store a synthetic `harness:` snapshot. The task detail run list displays the short snapshot reference.

### Templates

Project templates and agent templates reduce setup friction.

Examples:

- Web app team
- Unity game team
- Mobile app team
- Research assistant team
- Content production team

Initial implementation: global agent templates are stored in the app-wide Harness database. The agent panel can apply templates to the create form and save the current form as a reusable template; PM, programmer, and review templates are seeded by default.

Initial implementation: global project templates are also stored in the app-wide Harness database. The project create form can seed a new folder with a starter agent team such as software engineering, research, or content production, and `/api/project-templates` can create custom project templates.

Initial implementation: agent, workflow, and project templates can also be created from the headless CLI, with workflow steps and project template agents supplied as inline JSON or JSON files.

### Parallel Agent Scheduling

Harness should include a scheduler that can run multiple agent tasks at once while respecting dependencies, project limits, and human approval gates.

Scheduling rules:

- Independent tasks can run in parallel.
- Dependent tasks must wait for their prerequisites.
- The PM agent can create, pause, reorder, or reassign tasks.
- The PM agent should inspect completion output before deciding the next handoff.
- PM handoff decisions run automatically by default.
- Users can set concurrency limits per project and per agent.

Initial implementation: the scheduler can start all ready tasks while respecting each agent's `maxParallel` limit. PM planning can optionally auto-start ready tasks after creating the plan. Dependent tasks are unblocked automatically when prerequisites complete through agent execution, when a human manually marks the prerequisite Done, or when a dependency is explicitly waived. The PM runtime records completion-output evaluations before handoff decisions. Tasks can also be paused and resumed through the UI, API, and CLI; paused tasks stay out of scheduler runs until resumed to Selected. Tasks can be moved up or down within their board column, and the scheduler uses that board order when selecting ready work. Parent tasks can be decomposed into parallel or sequential child tasks so large work can become a visible dependency graph without leaving the task drawer.

### Sequential Workflow Chains

Some work should move through a planned chain of agents.

Example chains:

- Product Planner -> Technical Planner -> Programmer -> Reviewer
- PM Agent -> Frontend Agent -> QA Agent -> Documentation Agent
- Research Agent -> Analyst Agent -> Writer Agent

The system should support explicit workflow templates, but the PM agent should also be able to choose the next agent dynamically.

Default behavior: sequential workflow chains advance automatically after each agent finishes unless a risk boundary requires approval.

Initial implementation: global workflow templates are stored in the app-wide Harness database. PM planning and document-based planning can select a reusable template such as `Plan, Build, Review` or `Build and Review`, then create tasks from each step's role, title template, description template, and acceptance criteria.

### Agent Workspaces

When agents execute code work in parallel, Harness should avoid file conflicts. Candidate strategies:

- Separate Git branches per task
- Separate Git worktrees per agent or task
- Patch-based output from each agent
- Human/PM merge step before applying changes to the main project folder

Decision: Harness should use Git worktree per task as the default execution isolation strategy.

Default worktree policy:

- Each executable task gets its own Git branch and worktree.
- The agent runs inside that task-specific worktree.
- Parallel agents must not write directly to the main project checkout.
- Task output is reviewed before being merged back into the main project branch.
- The PM agent can recommend merge order when multiple completed tasks touch related areas.
- The user can approve, reject, or request changes before merge.

Initial implementation: pending merges can be approved into the main checkout or sent back for changes from the task detail controls, CLI merge commands, or the shared Approvals queue. Merge conflicts leave the main checkout in an explicit conflict state, mark the task as `conflict`, and can be finalized after local resolution from the UI, API, or CLI. Requesting changes from a pending or conflicted merge returns the task to Selected, clears the merge state, records the reason, aborts any in-progress conflicted merge, and keeps the task worktree/branch available for another run.

Initial implementation: projects without Git or without a first commit can be initialized from the UI, API, or CLI through the workspace provider. The flow runs `git init` when needed, excludes `.harness/` from Git, and creates a baseline Harness commit so task worktrees have a stable starting `HEAD`.

Initial implementation: tasks can choose `workspaceMode` per task. `worktree` remains the default and creates a task branch plus Git worktree. `harness` creates a Harness-managed directory under `.harness/workspaces/<task-id>` for non-code or non-Git tasks, records a synthetic `harness:` snapshot, skips branch creation, and skips commit/merge approval.

Initial implementation: task creation now supports automatic workspace selection. If no explicit mode is supplied, Harness inspects title, description, labels, assignee role, capabilities, and allowed tools. Code/developer/shell/git/test signals choose `worktree`; docs/planning/research/PM signals choose `harness`; ambiguous work stays on the safer `worktree` default.

Benefits:

- Safer parallel execution.
- Clear task-to-code ownership.
- Easier rollback.
- Easier review of each agent's changes.
- Better auditability for who changed what and why.

Open constraints:

- Harness workspace mode covers the first non-Git execution path; future provider strategies can add patch or container isolation.
- Large repositories may make many worktrees expensive.
- More advanced merge conflict visualization and guided file-level resolution can be layered on top of the current resolve/request-changes flow.
- Additional scheduler heuristics can later learn from project history and file impact, but the first automatic mode selection is in place for common documentation, planning, and research tasks.

## 7. Recommended Development Stack

Recommended direction: local-first TypeScript application that starts as a local web app and can later be packaged as a desktop app.

### Platform Strategy

MVP should support a browser-based local web app because it is faster to test, debug, and iterate.

Target platform path:

1. Local web app for MVP development and testing.
2. Mac desktop app once core workflows are proven.
3. Windows desktop app after the Mac version stabilizes.

The architecture should avoid painting the product into a web-only corner. Local filesystem access, process execution, and CLI integration should sit behind a backend API that can be reused by both the web app and desktop shell.

### Desktop Shell

Tauri is recommended over Electron for a lightweight local desktop app. It can run a web UI while still allowing controlled local filesystem and command execution through a Rust backend.

Alternative: Electron if Node-native integration is more important than bundle size.

For MVP, Tauri packaging can be deferred while keeping the frontend and backend boundaries compatible with a future Tauri shell.

### Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- Zustand or Jotai for local UI state
- Tailwind CSS or CSS modules
- Radix UI primitives for accessible controls

### Backend

- Local Node/TypeScript server for MVP web execution.
- Backend API for project management, board state, agent management, scheduling, and CLI execution.
- Future Tauri Rust commands for desktop filesystem/process boundaries.
- Optional worker processes for long-running agent execution.

### Provider Architecture

Harness should use provider interfaces for functionality that varies by operating system, runtime, model provider, or execution backend.

Provider categories:

- Platform provider: filesystem, shell execution, process management, path handling, OS-specific defaults, and command execution primitives.
- LLM provider: model-specific CLI invocation, prompt payload formatting, environment variables, output parsing.
- Workspace provider: Git worktree strategy, patch strategy, or future containerized execution.
- Approval provider: local human approval, future remote/team approval, or policy-based auto approval.
- Policy provider: agent tool permission checks, boundary enforcement, and future team/runtime policy decisions.

Initial providers:

- `node-darwin` platform provider for local Mac MVP.
- Future `node-win32` platform provider for Windows.
- `git-worktree` workspace provider for one branch and worktree per executable code task, plus Harness-managed workspaces for non-Git tasks.
- `local-human` approval provider for command execution and merge approval gates.
- `local-agent-policy` provider for checking agent allowed tools before command-backed LLM execution.
- `mock` LLM provider for deterministic local testing.
- `shell` LLM provider for user-configured CLI commands.
- `codex` LLM CLI provider slot.
- `claude` LLM CLI provider slot.
- `gemini` LLM CLI provider slot.
- `ollama` LLM CLI provider slot.
- `openrouter` LLM CLI wrapper provider slot.

Implementation rule: runtime orchestration should call provider interfaces instead of embedding OS-specific or model-specific behavior directly.

LLM providers should receive a generated prompt file and normalized environment variables so each CLI can be adapted without changing the scheduler or Kanban runtime.

Initial implementation: provider command defaults can be configured globally and per project. Agent-specific CLI commands override project provider commands, and project provider commands inherit from global defaults.

Initial implementation: runtime platform behavior is selected through explicit Node platform providers such as `node-darwin`, `node-win32`, and `node-linux`-style fallbacks. Runtime workspace behavior is selected through a workspace provider that owns task worktree/workspace creation, snapshotting, changed-file collection, commits, and merge operations. The first provider supports both Git worktrees and Harness-managed non-Git workspaces, selected by each task's `workspaceMode` or inferred automatically at task creation. LLM providers receive mode-aware workspace context through `HARNESS_WORKSPACE_KIND`, `HARNESS_WORKSPACE_MODE`, `HARNESS_WORKSPACE_PATH`, and a compatibility `HARNESS_WORKTREE_PATH`. Runtime approval behavior is selected through a `local-human` approval provider that owns command approval policy, decision messages, and rejection reasons while the project database stores the approval records. Runtime policy behavior is selected through a `local-agent-policy` provider that blocks command-backed LLM providers unless the assigned agent allows `shell`, `llm-cli`, the provider kind, or the provider id, and forces approval for risky shell command patterns even when project command approvals are disabled. The provider catalog exposes the active platform provider label, OS id, shell, process group support, workspace provider capabilities, approval provider capabilities, policy provider capabilities, and LLM provider definitions through the API, UI Settings panel, and headless CLI.

### Database

- SQLite for local durable state
- Drizzle ORM or Prisma

SQLite fits the Kanban/task/event model well and keeps installation simple.

### Storage Model

Harness should use both project-local and global storage.

Project-local storage:

- Board tasks
- Project agents
- Project documents
- Project-specific memory
- Execution logs
- Handoffs
- Project settings

Global storage:

- Registered project list
- Global user preferences
- LLM CLI backend definitions
- Global agent templates
- Global model/router settings
- App update and telemetry preferences, if any

Initial implementation: Harness stores global settings for app-wide defaults, global memory for cross-project user preferences, and project-local settings for default LLM backend, provider command defaults, default agent concurrency, project-wide concurrency, PM plan auto-start behavior, and command approval policy. Harness also stores project-local memory entries for conventions and preferences that should travel with agent execution.

Initial implementation: command-backed LLM providers respect a project-configurable run timeout inherited from global defaults. Timed-out commands fail the run, unblock the runner, and leave an audit error on the task.

Initial implementation: global and project-local settings can be inspected and updated from the headless CLI, including provider command maps and handoff rule maps supplied as inline JSON or JSON files.

Candidate paths:

- Project-local: `<project>/.harness/`
- Global macOS: `~/Library/Application Support/Harness/`
- Global cross-platform fallback: `~/.harness/`

### Agent Runtime

- Agent runner process per task or per agent session
- Structured event stream from runner to app
- Adapter interface for each LLM CLI backend
- Queue-based scheduler for pending tasks
- Parallel execution with dependency-aware scheduling
- PM-driven handoff decisions after task completion
- Automatic handoff by default with approval gates for risky actions
- Project-configurable role-to-role handoff rules
- Approval queue for command execution requests
- Configurable per-agent and per-project concurrency limits
- Persistent run state so interrupted work can be resumed or audited

Initial implementation: when the server starts, Harness scans registered projects for stale `running` runs, closes them as failed interruption records, resets affected in-progress tasks to `Selected` with an audit note, and marks stale busy agents idle so work can be retried.

### Packaging

- Local web app for MVP validation
- Local desktop app for normal users
- Optional CLI package for automation and headless runs

Initial implementation: the server package includes a JSON CLI for headless project listing, project registration/update/unregistration, project Git initialization, project root import, project overview, project health reporting, global/project settings management, provider catalog inspection, template listing and creation, agent create/update/list flows, board/task/run inspection, document create/update/list/plan flows, memory create/update/list flows, PM plan creation, task creation with automatic or explicit workspace mode, task decomposition, task updates including per-task workspace mode, task reorder, task pause/resume, task comments, approval decisions, merge decisions, conflicted merge resolution, ready-task scheduling, and single-task starts. The CLI uses the same global and project-local storage as the local web app and can create templates, seed project templates, configure agents, inspect board and run state, create plans from goal text/files, maintain project memory, or turn saved documents into workflow-template-backed tickets.

## 8. Draft Product Structure

### Main Navigation

- Projects
- Board
- Backlog
- Agents
- Runs
- Documents
- Settings

Initial implementation: project-local documents can be created and edited from the UI, stored in the project `.harness` database, and returned as part of the project overview.

Documents can also be used as PM planning input so a stored spec or service plan can be decomposed into Kanban tickets.

### Board Columns

Initial Jira-like columns:

- Backlog
- Selected for Development
- In Progress
- In Review
- Paused
- Blocked
- Done

### Task Detail Panel

The task detail view should include:

- Title and status
- Assignee agent
- Description
- Acceptance criteria
- Editable status, priority, assignee, description, and acceptance criteria
- Subtasks
- Activity timeline
- Agent execution logs
- Handoff history
- Linked files
- Comments
- Human approval prompts

Initial implementation: board cards can open a task detail drawer showing editable metadata, labels, parent/subtask links, dependencies, workspace mode, branch/worktree, merge state, task-scoped comments, task-scoped runs, changed files, run output/errors, follow-up task creation, handoff history, and an activity timeline.

Initial implementation: the headless CLI can show the Kanban board grouped by status, list tasks with status/assignee/label filters, show task-scoped comments, runs, approvals, handoffs, and events, and inspect run records with filters for status, task, agent, provider, and model backend.

### Agent Directory

The agent directory should include:

- Agent list
- Persona editor
- Model backend selector
- Tool permissions
- Current task
- Recent activity
- Performance metrics

Initial implementation: agents can be created and edited from the UI, including persona, role, model backend, CLI command override, capability tags, allowed tools, boundaries, templates, and per-agent parallelism. The agent directory also shows current work, recent activity, and completed/failed/running run counts per agent.

Initial implementation: agents can also be listed, created, and updated from the headless CLI so automation can configure persona-driven worker pools before planning or scheduling work.

## 9. MVP Scope Proposal

The first build should prove the local project, Kanban model, and real agent execution loop before complex autonomy.

MVP features:

- Create/open local project folders.
- Show project-level task, blocker, approval, run, and merge summaries in the project list.
- Create and edit agents with personas, capabilities, allowed tools, boundaries, model backends, CLI overrides, and concurrency limits.
- Create/edit Kanban tasks.
- Create a PM plan from a user goal and turn it into assigned Kanban tasks.
- Assign a task to an agent.
- Show agent status on board cards.
- Store project data in project-local SQLite and global app settings in a global database/config area.
- Add a PM agent profile that plans, assigns, monitors, and hands off work.
- Add one generic CLI adapter interface with at least one real executable adapter and one mock adapter for tests.
- Execute assigned work through the agent runtime.
- Support basic parallel execution for independent tasks.
- Support automatic sequential handoff for dependent tasks.
- Create a Git worktree per executable task.
- Show task worktree/branch information in the task detail view.
- Build Jira-like board, backlog, agent list, and task detail drawer.

Deferred from MVP:

- Advanced memory.
- Cloud sync.
- Team accounts.
- Marketplace/plugin system.
- Complex dependency graph UI.
- Advanced conflict resolution between parallel code-writing agents.
- Windows desktop packaging.

## 10. Planning Questions

Open questions to resolve before implementation:

1. Which LLM CLI should be integrated first?
2. Should the PM agent be mandatory for every project, or optional?
3. How much autonomy should agents have before asking for user approval?
4. Should task statuses be fixed initially, or configurable per project?
5. Should Harness support non-code projects from the beginning?
6. What should be the first real workflow used to test the product?
7. What is the safest default concurrency limit for MVP?
8. Should project-local `.harness` data be committed to Git by default, ignored by default, or partially committed?

## 11. Future Ticketization Plan

After the service plan is approved, break the work into ticket groups:

1. Product foundation
2. Local project storage
3. Kanban data model
4. Jira-like UI shell
5. Agent persona management
6. PM agent planning workflow
7. CLI adapter layer
8. Agent execution tracking
9. Review and approval gates
10. Packaging and local setup

Each ticket should include:

- User story
- Scope
- Acceptance criteria
- Data model impact
- UI impact
- Test plan
- Dependencies
