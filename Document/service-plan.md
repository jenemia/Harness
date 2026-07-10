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

Initial implementation: shell-backed LLM providers create a command execution approval request before any configured CLI command runs. The task is blocked until the user approves or rejects the request from the Approvals panel. Approved tasks resume automatically; rejected tasks remain blocked and the decision is recorded in the timeline.

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

### Dependency And Blocker Tracking

Tasks should support dependencies, blockers, and blocked reasons. The board should make blocked work visually obvious.

Dependency tracking is required for safe parallelism. A task should not become executable until its required predecessors are done or explicitly waived by the user/PM agent.

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

### Review Agent

A dedicated review agent can inspect completed work before the task moves to Done. This keeps PM orchestration and quality control separate.

### Agent Memory

Agents should remember project-specific conventions, decisions, recurring mistakes, and user preferences. Memory should be scoped by project unless explicitly promoted globally.

Initial implementation: project-local memory entries can be created and edited from the UI, stored in the project `.harness` database, and injected into every agent run through the generated prompt file plus `HARNESS_PROJECT_MEMORY` and `HARNESS_PROJECT_MEMORY_FILE`.

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

Initial implementation: every run stores the assigned agent, effective model backend, provider id, command preview when applicable, worktree path, branch, snapshot ref, changed files, output, error, and timestamps. Task detail and timeline views expose this audit trail.

### Workspace Snapshots

Before an agent starts risky work, Harness can create a lightweight snapshot such as a Git branch, stash, patch file, or checkpoint record.

Initial implementation: every run records the task worktree's starting Git `HEAD` as a snapshot reference before the agent provider executes, and the task detail run list displays the short snapshot SHA.

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

### Parallel Agent Scheduling

Harness should include a scheduler that can run multiple agent tasks at once while respecting dependencies, project limits, and human approval gates.

Scheduling rules:

- Independent tasks can run in parallel.
- Dependent tasks must wait for their prerequisites.
- The PM agent can create, pause, reorder, or reassign tasks.
- The PM agent should inspect completion output before deciding the next handoff.
- PM handoff decisions run automatically by default.
- Users can set concurrency limits per project and per agent.

Initial implementation: the scheduler can start all ready tasks while respecting each agent's `maxParallel` limit. PM planning can optionally auto-start ready tasks after creating the plan. Dependent tasks are unblocked automatically when prerequisites complete through agent execution or when a human manually marks the prerequisite Done.

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

Initial implementation: pending or conflicted merges can be approved into the main checkout or sent back for changes. Requesting changes returns the task to Selected, clears the pending merge state, records the reason, and keeps the task worktree/branch available for another run.

Benefits:

- Safer parallel execution.
- Clear task-to-code ownership.
- Easier rollback.
- Easier review of each agent's changes.
- Better auditability for who changed what and why.

Open constraints:

- Projects without Git need an initialization flow or a non-Git fallback.
- Large repositories may make many worktrees expensive.
- Merge conflict handling needs a clear UX.
- Some non-code tasks may not need a worktree.

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

- Platform provider: filesystem, shell execution, process management, path handling, Git behavior, OS-specific defaults.
- LLM provider: model-specific CLI invocation, prompt payload formatting, environment variables, output parsing.
- Workspace provider: Git worktree strategy, patch strategy, or future containerized execution.
- Approval provider: local human approval, future remote/team approval, or policy-based auto approval.

Initial providers:

- `node-darwin` platform provider for local Mac MVP.
- Future `node-win32` platform provider for Windows.
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

Initial implementation: Harness stores global settings for app-wide defaults and project-local settings for default LLM backend, provider command defaults, default agent concurrency, project-wide concurrency, PM plan auto-start behavior, and command approval policy. Harness also stores project-local memory entries for conventions and preferences that should travel with agent execution.

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

Initial implementation: the server package includes a JSON CLI for headless project listing, project registration, project overview, template listing, PM plan creation, ready-task scheduling, and single-task starts. The CLI uses the same global and project-local storage as the local web app and can seed project templates or create plans from goal text/files.

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

Initial implementation: board cards can open a task detail drawer showing editable metadata, labels, parent/subtask links, dependencies, branch/worktree, merge state, task-scoped comments, task-scoped runs, changed files, run output/errors, follow-up task creation, handoff history, and an activity timeline.

### Agent Directory

The agent directory should include:

- Agent list
- Persona editor
- Model backend selector
- Tool permissions
- Current task
- Recent activity
- Performance metrics

Initial implementation: agents can be created and edited from the UI, including persona, role, model backend, CLI command override, capability tags, templates, and per-agent parallelism. The agent directory also shows current work, recent activity, and completed/failed/running run counts per agent.

## 9. MVP Scope Proposal

The first build should prove the local project, Kanban model, and real agent execution loop before complex autonomy.

MVP features:

- Create/open local project folders.
- Show project-level task, blocker, approval, run, and merge summaries in the project list.
- Create and edit agents with personas, capabilities, model backends, CLI overrides, and concurrency limits.
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
