# Harness Implementation Tickets

This document turns the service plan into structured ticket blocks that the local planning provider can preview or convert into Kanban work.

### T01: Product foundation and project registry
Role: project-manager
User story:
- As a local user, I can create, register, import, rename, relink, and unregister Harness projects without losing project-local data.
Scope:
- Harden project registry flows around missing folders, plain folders, Git repositories, and existing `.harness` folders.
- Keep project list summaries fast and read-only when scanning moved or unavailable project paths.
Acceptance criteria:
- Project list shows folder availability, database availability, and summary errors without creating new project data during read operations.
- Registry update and unregister flows are available from UI, API, and CLI.
Data model impact:
- Preserve global project registry records separately from project-local `.harness` data.
UI impact:
- Project sidebar continues to show project health signals and relink actions.
Test plan:
- CLI smoke tests for register, import-root, update, unregister, and overview.
Dependencies:
- None

### T02: Project-local storage and settings inheritance
Role: programmer
Depends on: T01
User story:
- As a user with multiple folders, each project carries its own settings, memory, documents, tasks, and run history while global defaults still apply.
Scope:
- Keep global settings, global memory, templates, and project registry in app-wide storage.
- Keep tasks, agents, documents, project memory, approvals, handoffs, runs, and project settings inside each project.
Acceptance criteria:
- Project provider commands inherit global defaults and project values override only matching keys.
- Project settings can be inspected and updated through UI, API, and CLI.
Data model impact:
- Project-local settings remain in `<project>/.harness/harness.db`.
UI impact:
- Settings panel exposes global and project sections without mixing ownership.
Test plan:
- CLI smoke proves global provider command plus project override both appear in effective project settings.
Dependencies:
- T01

### T03: Kanban task model and board operations
Role: programmer
Depends on: T02
User story:
- As a human or PM agent, I can track work across Backlog, Selected, In Progress, In Review, Paused, Blocked, and Done.
Scope:
- Support task creation, edits, ordering, filters, comments, linked files, labels, parent/subtask links, dependencies, and waived dependencies.
- Keep Selected as the scheduler queue and Backlog as the planning queue.
Acceptance criteria:
- Board, backlog queue, task drawer, API, and CLI expose consistent task state.
- Scheduler respects status, task order, dependencies, waived dependencies, and paused tasks.
Data model impact:
- Tasks store labels, links, dependency ids, waived dependency ids, workspace mode, merge state, and ordering.
UI impact:
- Board cards and task drawer remain scannable with Jira-like controls.
Test plan:
- CLI smoke for tasks:create, tasks:update, tasks:move, tasks:pause, tasks:resume, board:show.
Dependencies:
- T02

### T04: Agent persona directory and reusable templates
Role: programmer
Depends on: T02
User story:
- As a project owner, I can define multiple agents with persona, role, model backend, tools, boundaries, and concurrency.
Scope:
- Manage project agents plus global agent and project templates.
- Expose agent status, current work, recent runs, allowed tools, capabilities, and max parallelism.
Acceptance criteria:
- Agents can be created and updated from UI and CLI.
- Templates can seed software engineering, research, and content production teams.
Data model impact:
- Agent records include role, persona, backend, CLI override, capabilities, allowed tools, boundaries, status, and maxParallel.
UI impact:
- Agent panel supports template apply/save and compact operational status.
Test plan:
- CLI smoke for agents:create, agents:update, templates:agents, templates:project-create.
Dependencies:
- T02

### T05: PM planning and structured ticket parsing
Role: programmer
Depends on: T03, T04
User story:
- As a user, I can turn a goal, service plan, or ticket document into previewable Kanban tasks before writing them to the board.
Scope:
- Support explicit bullet planning, workflow templates, sequential/parallel/auto modes, large plan warnings, and structured Markdown ticket blocks.
- Assign work by role using current and planned agent load.
Acceptance criteria:
- `### T01: Title` ticket blocks preserve role, description fields, acceptance criteria, and dependency references in plan preview.
- Plan creation records assignment summary and plan metadata in the timeline.
Data model impact:
- Planned tasks carry `pm-plan` and `role:<role>` labels plus dependency ids.
UI impact:
- PM Plan and Documents panels can preview and create tasks from stored documents.
Test plan:
- CLI smoke for plans:preview and documents:plan-preview using this document.
Dependencies:
- T03, T04

### T06: Provider-based LLM execution layer
Role: programmer
Depends on: T04
User story:
- As a technical user, I can route agents to different LLM CLI providers without changing scheduler or board logic.
Scope:
- Keep platform, LLM, workspace, approval, planning, and policy behavior behind provider interfaces.
- Support mock, shell, Codex CLI, Claude Code CLI, Gemini CLI, Ollama, and OpenRouter-compatible wrappers.
Acceptance criteria:
- Provider command lookup supports `<platformProviderId>.<modelBackend>`, `<nodePlatform>.<modelBackend>`, and `<modelBackend>`.
- Settings UI and provider catalog expose command key examples and insertion shortcuts.
Data model impact:
- Runs record model backend, provider id, command preview, provider command key, platform provider, and timeout errors.
UI impact:
- Settings and run detail views show provider resolution clearly.
Test plan:
- CLI smoke for providers:list and command-backed provider approval flow.
Dependencies:
- T04

### T07: Worktree workspace execution and merge flow
Role: programmer
Depends on: T03, T06
User story:
- As a user running parallel coding agents, each executable task gets an isolated Git worktree and a controlled merge path.
Scope:
- Initialize Git when needed, create branch/worktree per executable task, record snapshots, collect changed files, and support Harness workspace mode for non-Git tasks.
- Queue merge approvals and handle conflicts without hiding local Git state.
Acceptance criteria:
- Worktree tasks create branch/worktree, commit changed files, and request merge approval.
- Harness workspace tasks skip Git merge while preserving artifacts and snapshot metadata.
Data model impact:
- Tasks and runs store branch, workspace path, snapshot ref, changed files, and merge status.
UI impact:
- Task drawer exposes workspace, branch, changed files, merge actions, and conflict state.
Test plan:
- CLI smoke for projects:init-git, tasks:start, tasks:merge, tasks:resolve-merge, tasks:request-changes.
Dependencies:
- T03, T06

### T08: Scheduler, concurrency, and automatic handoff
Role: programmer
Depends on: T05, T07
User story:
- As a user, I can let multiple agents work in parallel when dependencies allow, while sequential chains advance only after prerequisites complete.
Scope:
- Respect agent maxParallel, project max parallelism, dependencies, approval gates, paused tasks, and board order.
- Evaluate completion output before choosing Done, follow-up creation, configured handoff, or dynamic fallback handoff.
Acceptance criteria:
- Scheduler reports started and skipped tasks with reasons.
- PM evaluation records signals, changed-file count, handoff decisions, and follow-up task creation events.
Data model impact:
- Runs, handoffs, approvals, and events preserve orchestration history.
UI impact:
- Health and Attention panels surface scheduler gaps, failed runs, handoffs, approvals, and follow-up backlog.
Test plan:
- CLI smoke for tasks:schedule, tasks:start, runs:list, runs:followups, approvals:list.
Dependencies:
- T05, T07

### T09: Review, approval, and audit surfaces
Role: reviewer
Depends on: T06, T07, T08
User story:
- As a human operator, I can see what each agent did, approve risky actions, and inspect enough evidence to trust or reject the work.
Scope:
- Support command approvals, risky command policy, risky PM handoff approval, merge approvals, run filters, timelines, comments, and health reports.
Acceptance criteria:
- Approvals can be filtered by status, kind, task, and agent from UI and CLI.
- Task timeline includes run, approval, policy, PM evaluation, handoff, follow-up, and merge events.
Data model impact:
- Approval and event metadata include provider command resolution, risk tags, decision source, and rejection reasons.
UI impact:
- Approvals panel, Runs panel, Task drawer, Health panel, and Attention panel remain consistent.
Test plan:
- CLI smoke for approvals:list, approvals:approve, approvals:reject, projects:report, runs:show.
Dependencies:
- T06, T07, T08

### T10: Local setup, web runtime, and desktop-ready boundary
Role: project-manager
Depends on: T01, T06, T09
User story:
- As a local user, I can install and run Harness as a web app today while the architecture remains ready for Mac and Windows desktop packaging later.
Scope:
- Keep Node/TypeScript server as the local API/process boundary and React as the reusable UI.
- Serve built web assets from the server after production build.
- Document startup, CLI usage, provider setup, and future Tauri packaging boundary.
Acceptance criteria:
- `pnpm build` and `pnpm start` serve the API and web app from one local process.
- README includes development, single-server runtime, CLI examples, and provider setup notes.
Data model impact:
- None beyond existing global and project-local storage.
UI impact:
- No separate landing page is required; the usable workspace remains first screen.
Test plan:
- Typecheck, production build, CLI provider smoke, and local server smoke.
Dependencies:
- T01, T06, T09

## Operational improvements (without a company/org model)

These tickets take the useful operational patterns from multi-agent control planes while keeping Harness focused on a single project board, accountable task cards, and local-first execution.

### T11: Measured provider usage and project budget gate
Role: programmer
Depends on: T06, T08, T09
User story:
- As a project owner, I can see measured provider usage and prevent new agent runs after a project budget is consumed.
Scope:
- Persist normalized, delta-based `usage` provider events in an immutable local ledger.
- Add an optional monthly project cost ceiling; zero means disabled.
- Block new runs once measured spend reaches the ceiling, while leaving existing run history and approvals intact.
Acceptance criteria:
- A provider usage event can record input, output, total tokens, and an explicitly reported USD cost without storing prompts or credentials.
- Retention pruning of live provider events cannot erase the budget ledger.
- The scheduler and direct task start both reject new work at the measured budget hard stop and record an audit event.
- Providers that do not report cost remain visibly unmeasured; Harness must not invent an estimated cost.
Implementation direction:
- Treat every usage payload as a delta, keyed by run and event sequence for idempotency.
- Add provider adapters incrementally; ship the shared ledger and gate before declaring a provider cost-aware.

### T12: Goal context packet and explicit task ancestry
Role: programmer
Depends on: T03, T05, T08
User story:
- As an assigned agent, I receive the task's concise purpose, active sub-goal, parent chain, dependencies, and completion criteria in one consistent context packet.
Scope:
- Introduce project goals and links from cards/sub-goals to those goals.
- Render a bounded ancestry section in execution prompts, task detail, handoffs, and completion reports.
Acceptance criteria:
- A task can be traced from its active goal to an optional project goal without duplicating free-form text.
- Prompt construction limits ancestry depth and redacts non-execution context.
- Hand-offs preserve the next goal and acceptance evidence.

### T13: Durable execution leases and recovery policy
Role: programmer
Depends on: T08
User story:
- As an operator, I never lose track of work after a crash or accidentally run the same task twice.
Scope:
- Replace process-local reservations with DB-backed execution leases, lease expiry, single-owner claiming, and recovery decisions.
- Differentiate safe retry, human review required, and cleanup-only recovery outcomes.
Acceptance criteria:
- Concurrent start attempts produce one owner and one audit trail.
- Recovery neither silently restarts a destructive run nor leaves stale capacity permanently consumed.
- Lease state is exposed with runs and scheduler diagnostics.

### T14: Policy profiles for approvals and execution controls
Role: security-reviewer
Depends on: T09, T11
User story:
- As a project owner, I can apply named, versioned policies to task risk instead of remembering ad-hoc settings.
Scope:
- Define local policy profiles for command approval, workspace protection, budget response, review limits, and merge requirements.
- Snapshot the policy version used by each decision and retain an undo-safe change history.
Acceptance criteria:
- A task/run audit identifies the policy profile and revision that allowed, paused, or blocked it.
- Policy changes affect new executions only unless explicitly re-evaluated.
- The UI explains the applicable gate and how to resolve it.

### T15: Scheduled maintenance cards
Role: programmer
Depends on: T08, T13
User story:
- As an operator, I can schedule recurring review, health, and maintenance work as normal, auditable task cards.
Scope:
- Add local cron/interval triggers, deduplication keys, concurrency/catch-up policy, and an execution history.
- Materialize every trigger as a card rather than a hidden background prompt.
Acceptance criteria:
- Missed triggers follow an explicit skip, coalesce, or catch-up policy.
- A routine cannot create overlapping copies beyond its configured limit.
- Generated work respects the same approval, workspace, budget, and review gates as manual work.
