# Harness

Harness is a local-first multi-agent Kanban execution framework. It starts as a local web app for fast MVP iteration and is structured so the same backend boundary can later be wrapped by a desktop shell.

## MVP

- Local project registry with project-local `.harness/` storage.
- Project root scanning for importing existing Harness folders and Git repositories.
- Native OS folder selection for adding, scanning, and re-linking project folders without typing paths.
- Git initialization flow for plain folders that need a baseline commit before agent worktrees can run.
- Project sidebar summaries for task, backlog, selected, blocker, failed run, approval, running, follow-up, and merge counts across local folders.
- Project health report for blockers, approvals, merges, failed runs, follow-up backlog items, scheduler readiness gaps, provider command setup gaps, and next recommended action.
- Attention panel for pending approvals, merges, failed runs, blocked tasks, and follow-up backlog items.
- Project templates for seeding new folders with a useful starter agent team.
- Jira-like Kanban board and backlog queue with task search, assignee filtering, label filtering, ready selection, and board-order controls.
- Single prompt-based work creation modal with plain text, Markdown lists, and structured Markdown ticket support.
- Jira-like task detail drawer with editable metadata, labels, linked files, parent/subtask links, dependencies, runs, changed files, handoff decision badges, timeline, workspace, and merge state.
- Project-local Documents panel for specs, notes, and planning material.
- Project-local and global Memory panel for conventions and preferences injected into agent prompts.
- Agent persona, backend, capability, allowed tool, boundary, template, current work, run metrics, and concurrency management.
- Task assignment and execution.
- PM planning endpoint that decomposes a goal into assigned Kanban tasks.
- Task-level decomposition for turning a parent task into parallel or sequential subtasks.
- Workflow templates for reusable PM planning role chains.
- Selected-task scheduler with agent `maxParallel` capacity checks; Backlog stays as a planning queue until promoted.
- Scheduler result feedback showing started and skipped task counts after manual or PM-triggered scheduling.
- Dependency waiver support for explicitly unblocking tasks when a prerequisite no longer applies.
- Git worktree per executable task.
- Harness workspace mode for non-code tasks that do not need Git worktrees.
- Automatic workspace mode selection for common code, docs, planning, and research task signals.
- Automatic PM-driven handoff with project-level handoff rules, dynamic fallback routing, and approval gates for risky handoffs, LLM CLI command execution, and merge.
- PM completion evaluation events before automatic handoffs or Done transitions.
- Follow-up ticket creation from PM review, task drawer, API, or CLI when agent output contains next-step or TODO signals, with duplicate child follow-ups skipped.
- Startup recovery for interrupted runs so stale busy agents and in-progress tasks can be audited and retried.
- Run audit fields for model backend, provider, command preview, worktree, snapshot, and changed files.
- Configurable run timeout for command-backed providers.
- Provider-based platform, workspace, planning, approval, policy, and LLM adapters.
- Built-in LLM provider slots: mock, shell, Codex CLI, Claude Code CLI, Gemini CLI, Ollama, and OpenRouter-compatible wrappers.
- Provider catalog exposes OS/model-specific command key precedence and examples for configuring CLI backends, with Settings shortcuts for inserting matching command keys.
- Task-level model backend overrides for routing specific work to a different provider.
- Global settings for app-wide defaults and project-local settings for default LLM backend, provider commands, agent concurrency, project concurrency, PM plan auto-start, large plan confirmation threshold, and command approval policy.

LLM CLI providers run inside the task workspace and receive Harness context through environment variables, including `HARNESS_PROMPT_FILE`, `HARNESS_AGENT_PERSONA`, `HARNESS_TASK_TITLE`, `HARNESS_TASK_COMMENTS`, `HARNESS_TASK_RUN_SUMMARY`, `HARNESS_WORKSPACE_KIND`, `HARNESS_WORKSPACE_PATH`, and the backward-compatible `HARNESS_WORKTREE_PATH`.

Global memory is written to `.harness/global-memory.md` and exposed as `HARNESS_GLOBAL_MEMORY` and `HARNESS_GLOBAL_MEMORY_FILE`. Project memory is written to `.harness/project-memory.md` and exposed as `HARNESS_PROJECT_MEMORY` and `HARNESS_PROJECT_MEMORY_FILE`.

Shell-backed providers require matching agent tool permission before execution. Agents need `shell`, `llm-cli`, the provider kind, or the provider id in `allowedTools` before a command-backed LLM provider can run.

Shell-backed providers also require human approval before their configured command runs when the current project has command approvals enabled. Pending requests appear in the Approvals panel and can be approved or rejected without losing task context.

Risky shell commands require approval even when project command approvals are otherwise disabled. The local policy provider currently flags recursive forced deletes, hard Git resets, Git clean, Git push, sudo, package install/update commands, and remote scripts piped into a shell.

Completed task worktree changes create merge approval requests. Approving the request merges the task branch into the main checkout; rejecting it sends the task back to `Selected` with changes requested.

If a merge hits conflicts, Harness leaves the conflicted merge in the main checkout, marks the task as `conflict`, and keeps the branch/worktree attached to the task. Resolve and stage the conflicted files locally, then use `tasks:resolve-merge` or the task's `Resolve merge` action to finalize the merge commit. Requesting changes from a conflicted task aborts the in-progress merge and returns the task to `Selected`.

## Development

```bash
pnpm install
pnpm dev
```

The server runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.
If port 4000 is already busy, start the server with another `PORT` and run the web app with `VITE_API_PROXY_TARGET=http://localhost:<port>`.

For a single local server after building:

```bash
pnpm build
pnpm start
```

`pnpm start` serves the built web app and API from the server on `http://localhost:4000`. Set `PORT=<port>` to use another port, or `HARNESS_WEB_DIST=<folder>` to serve a custom web build.

## CLI

The server package also exposes a local JSON CLI for headless automation:

```bash
pnpm cli projects:list
pnpm cli projects:register --path ./my-project --name "My Project" --projectTemplate <templateId>
pnpm cli projects:import-root --root ~/Documents --includePlainFolders false
pnpm cli projects:init-git --project <projectId>
pnpm cli projects:update --project <projectId> --path ./moved-project --name "Moved Project"
pnpm cli projects:unregister --project <projectId>
pnpm cli projects:report --project <projectId>
pnpm cli settings:update --defaultModelBackend codex --largePlanTaskThreshold 12 --providerCommands '{"node-darwin.codex":"codex exec \"$HARNESS_PROMPT_FILE\"","codex":"codex exec \"$HARNESS_PROMPT_FILE\""}'
pnpm cli project-settings:update --project <projectId> --maxProjectParallel 3 --largePlanTaskThreshold 8 --requireCommandApproval true
pnpm cli providers:list
pnpm cli templates:projects
pnpm cli templates:workflows
pnpm cli templates:agent-create --name "Docs Agent" --role writer --persona "Write concise project docs" --capabilities docs,writing --allowedTools documents,memory --boundaries "Use only validated project facts"
pnpm cli templates:workflow-create --name "Build, Review, Docs" --stepsFile ./workflow.steps.json
pnpm cli templates:project-create --name "Frontend Team" --agentsFile ./project-template-agents.json
pnpm cli agents:create --project <projectId> --name "Frontend Agent" --role programmer --persona "Build polished React UI" --capabilities frontend,react --allowedTools worktree,shell,tests --boundaries "Stay inside the task worktree" --maxParallel 2
pnpm cli plans:preview --project <projectId> --goalFile ./Document/service-plan.md --mode sequential
pnpm cli plans:create --project <projectId> --goal "Build the next feature" --workflowTemplate <templateId>
pnpm cli plans:create --project <projectId> --goalFile ./Document/service-plan.md --mode sequential --allowLargePlan true
pnpm cli documents:create --project <projectId> --title "Service Plan" --contentFile ./Document/service-plan.md
pnpm cli documents:create --project <projectId> --title "Implementation Tickets" --contentFile ./Document/implementation-tickets.md
pnpm cli documents:plan-preview --project <projectId> --document <documentId> --workflowTemplate <templateId>
pnpm cli documents:plan --project <projectId> --document <documentId> --workflowTemplate <templateId> --allowLargePlan true
pnpm cli memories:create --project <projectId> --title "Coding conventions" --contentFile ./CONVENTIONS.md
pnpm cli global-memories:create --title "User preferences" --content "Prefer small focused commits"
pnpm cli board:show --project <projectId>
pnpm cli runs:list --project <projectId> --status completed,failed
pnpm cli runs:show --project <projectId> --run <runId>
pnpm cli runs:followups --project <projectId> --run <runId>
pnpm cli tasks:list --project <projectId> --status Selected,Blocked
pnpm cli tasks:show --project <projectId> --task <taskId>
pnpm cli tasks:create --project <projectId> --title "Wire up settings" --status Selected
pnpm cli tasks:create --project <projectId> --title "Draft release notes" --status Selected --workspaceMode harness
pnpm cli tasks:create --project <projectId> --title "Research onboarding notes" --status Selected --workspaceMode auto
pnpm cli tasks:create --project <projectId> --title "Review API shape" --linkedFiles apps/server/src/index.ts,apps/web/src/api.ts
pnpm cli tasks:update --project <projectId> --task <taskId> --status Done
pnpm cli tasks:update --project <projectId> --task <taskId> --waivedDependencies <dependencyTaskId>
pnpm cli tasks:decompose --project <projectId> --task <taskId> --mode sequential --itemsFile ./subtasks.txt
pnpm cli tasks:move --project <projectId> --task <taskId> --direction up
pnpm cli tasks:pause --project <projectId> --task <taskId> --reason "Waiting on product decision"
pnpm cli tasks:resume --project <projectId> --task <taskId>
pnpm cli tasks:comment --project <projectId> --task <taskId> --body "Reviewed from CLI"
pnpm cli approvals:list --project <projectId> --status pending --kind merge
pnpm cli approvals:approve --project <projectId> --approval <approvalId>
pnpm cli tasks:merge --project <projectId> --task <taskId>
pnpm cli tasks:resolve-merge --project <projectId> --task <taskId>
pnpm cli tasks:request-changes --project <projectId> --task <taskId> --reason "Needs another pass"
pnpm cli tasks:schedule --project <projectId>
```

The CLI uses the same global/project-local storage as the web app and honors `HARNESS_HOME`.

## Settings

Use the Settings panel, `/api/settings`, or `settings:get` and `settings:update` to configure global defaults. Global settings live in the global Harness data directory and provide the starting defaults for projects.

Each project also has project-local settings stored inside `<project>/.harness/harness.db`. Use the project Settings panel, `PATCH /api/projects/:projectId/settings`, or `project-settings:get` and `project-settings:update` to configure the current project's default LLM backend, provider command defaults, default agent concurrency, project-wide parallel run limit, run timeout, PM plan auto-start behavior, large plan confirmation threshold, command approval policy, and PM handoff rules.

Provider commands are a provider-to-command map. Agent-specific `cliCommand` values override project and global provider commands. Project/global command lookup checks OS-specific keys first, then the model key: `<platformProviderId>.<modelBackend>`, `<nodePlatform>.<modelBackend>`, then `<modelBackend>` such as `node-darwin.codex`, `darwin.codex`, and `codex`. A task can override its model backend; if it does, Harness uses that backend for approval checks, provider selection, prompt environment, and project-level provider command lookup.

Handoff rules are a role-to-role map. The default routes `programmer` and `worker` completions to `reviewer`. When no matching rule exists, the PM runtime can choose a dynamic fallback from completion signals and available agent roles, such as `researcher -> analyst -> writer` or changed/risky work to a reviewer. Dynamic handoffs with risk or error signals pause for human approval before the next agent starts. If no configured or dynamic handoff applies, the task moves to Done.

The provider catalog exposes the active OS platform provider, workspace isolation provider, planning provider, local approval provider, local policy provider, and available LLM providers through `/api/providers` and `providers:list`, including structured ticket parsing, planning, and approval capabilities. Project health reports also flag command-backed model backends that do not have an agent override or matching provider command key configured, plus Selected tasks that the scheduler cannot start because of dependency, project capacity, or agent capacity gaps.

## Project Templates

Use the project create form, `/api/project-templates`, or `templates:project-create` to start a folder with a reusable team shape. Harness seeds software engineering, research, and content production project templates; each one creates the starter agents for that workflow.

Agent and workflow templates can also be managed headlessly with `templates:agent-create` and `templates:workflow-create`.

Projects can be removed from the Harness registry with the sidebar remove button, `DELETE /api/projects/:projectId`, or `projects:unregister`. This only removes the app registry entry; the project folder and `.harness/` data stay on disk.

Project lists include folder and `.harness/harness.db` availability so moved or deleted folders can be spotted without recreating missing project data.

Moved folders can be re-linked with the sidebar relink form, `PATCH /api/projects/:projectId`, or `projects:update`. Updating a registry path does not create a new folder.

The project sidebar can scan the global default project root and import existing Harness folders or Git repositories. The same flow is available through `POST /api/projects/import-root` and `projects:import-root`; plain folders are included only when explicitly requested.

Folder controls in the web app open the host OS picker: Finder on macOS, the Windows folder dialog, and Zenity or KDialog on Linux. Linux desktops need either `zenity` or `kdialog` installed.

Projects without Git or without an initial commit can be initialized from the sidebar `Init Git` button, `POST /api/projects/:projectId/init-git`, or `projects:init-git`. Harness initializes the repository when needed, excludes `.harness/` from Git, and creates a baseline commit so task worktrees can be created safely.

## Agents

Use the Agents panel or the `agents:list`, `agents:create`, and `agents:update` CLI commands to manage persona-driven worker profiles, model backend defaults, CLI overrides, capabilities, allowed tools, boundaries, and per-agent concurrency.

## PM Planning

Use the dashboard's `Add work` button to turn a plain-language prompt or Markdown document into board tasks. The modal intentionally exposes no assignee, backend, priority, dependency, or planning-mode controls; `POST /api/projects/:projectId/tasks/from-prompt` applies automatic planning and assignment defaults. Advanced API and CLI callers can continue to use `/plan`, `/plan-preview`, and `plans:preview`. The first planning provider is deterministic and local: it creates requirement, design, implementation, and review tasks, assigns them by agent role, spreads assignments across matching agents by current and planned load, records assignment summaries in the plan event, and links sequential dependencies when requested.

Planning mode can be `auto`, `sequential`, or `parallel`. In `auto` mode, the PM planner records both the requested mode and the effective mode it chose: workflow templates and sequence/dependency wording become sequential chains, while independent bullet lists become parallel ready tasks.

Select a workflow template to make PM planning follow a reusable role chain. Harness seeds `Plan, Build, Review` and `Build and Review` templates, and exposes `/api/workflow-templates` for custom templates.

Set `autoStart` on the planning request or use `POST /api/projects/:projectId/schedule` to start Selected tasks while respecting each agent's `maxParallel` limit and the project's `maxProjectParallel` limit.

When a task is marked `Done`, Harness unblocks dependent tasks whose prerequisites are now complete and queues them for scheduling.

After a successful run, the PM runtime inspects the latest output and changed files before deciding the configured handoff, dynamic fallback handoff, or Done transition. The resulting `pm.evaluated` event appears in the task timeline, and handoff rows show decision source, target role, changed-file count, and detected signals.

Tasks can be paused from the board, task detail drawer, API, or CLI. Paused tasks stay out of scheduler runs until they are resumed back to `Selected`, and pause/resume events are recorded in the task timeline.

Tasks can be moved up or down within their current board column from the board, task detail drawer, API, or `tasks:move`. The scheduler reads the same board order when choosing Selected work.

Task dependencies can be explicitly waived from the task detail drawer, API, or `tasks:update --waivedDependencies`. Waived dependencies stay visible on the task, but the scheduler no longer blocks on them.

Large tasks can be decomposed from the task detail drawer, `POST /api/projects/:projectId/tasks/:taskId/decompose`, or `tasks:decompose`. Parallel decomposition creates ready child tasks, while sequential decomposition links each child to the previous child and marks downstream work blocked until dependencies complete.

When the server starts, Harness scans registered projects for runs that were left `running` by a previous process. Those runs are closed as failed with an interruption event, affected tasks return to `Selected`, and busy agents are reset to idle.

## Task Tracking

Open a task from the board to inspect its status, assignee, labels, linked files, parent/subtask links, workspace mode, worktree branch/path, dependencies, merge state, merge approval or requested changes, run snapshot, run output, errors, changed files, comments, PM handoff decision history, follow-up task creation, and task-scoped activity timeline. New tasks can use automatic workspace selection, while existing tasks keep an explicit `worktree` or `harness` mode.

The board can be filtered by task text, assignee, and label while preserving each task's column position and filtered column counts.

Each run records the effective model backend, provider id, command preview when a command-backed provider is used, starting snapshot, workspace path, and changed files. Run and approval timeline events also record the selected provider command key and platform provider, and the task Runs and Approvals panels surface that resolution beside the relevant run or request.

Recent completed or failed runs for the same task are injected into the generated agent prompt and `HARNESS_TASK_RUN_SUMMARY`, giving reviewer or handoff agents the prior agent output and changed-file context.

Task comments are injected into the generated agent prompt and `HARNESS_TASK_COMMENTS`, so human notes and handoff context travel into the next agent run.

Linked files are injected into the generated agent prompt and exposed to command-backed providers as `HARNESS_LINKED_FILES`, so model-specific CLI wrappers can use the same task context.

The Runs panel can be filtered by status, agent, provider, and model backend. Headless workflows can inspect the same Kanban state through `board:show`, filtered `tasks:list`, task-scoped `tasks:show`, filtered `runs:list`, run-scoped `runs:show`, and `runs:followups` for turning agent output into child tasks.

## Approvals

Harness blocks task execution before running shell-backed LLM providers until the user approves the request. Risky PM handoffs also pause in the same approval queue before the target agent starts. The Approvals panel and `approvals:list` can be filtered by approval kind while keeping pending and recent decisions visible. Approved tasks resume automatically. Rejected tasks remain blocked with the decision recorded in the task timeline.

Harness also queues merge approvals when a completed task has worktree changes waiting to land. Merge approvals can be accepted or sent back for changes from the same Approvals panel and CLI commands.

## Documents

Use the Documents panel to create and edit project-local notes, service plans, specs, and acceptance criteria. Documents are stored in the project-local Harness database and included in project overview state.

Document-to-plan workflows remain available headlessly through `documents:list`, `documents:create`, `documents:update`, `documents:plan-preview`, and `documents:plan`. The dashboard keeps document editing separate from work creation so all new work starts from the same simplified `Add work` modal.

## Memory

Use the Memory panel to store project conventions, user preferences, recurring decisions, and other durable context. Memory can be project-local or global. Both scopes are included in every agent prompt, with separate files and environment variables so agents can distinguish reusable preferences from project-specific context.

The same memory can be managed headlessly through `memories:list`, `memories:create`, `memories:update`, `global-memories:list`, `global-memories:create`, and `global-memories:update`.
