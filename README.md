# Harness

Harness is a local-first multi-agent Kanban execution framework. It starts as a local web app for fast MVP iteration and is structured so the same backend boundary can later be wrapped by a desktop shell.

## MVP

- Local project registry with project-local `.harness/` storage.
- Project sidebar summaries for task, blocker, approval, running, and merge counts across local folders.
- Jira-like Kanban board.
- Jira-like task detail drawer with editable metadata, dependencies, runs, timeline, worktree, and merge state.
- Project-local Documents panel for specs, notes, and planning material.
- Agent persona, backend, capability, and concurrency management.
- Task assignment and execution.
- PM planning endpoint that decomposes a goal into assigned Kanban tasks.
- Ready-task scheduler with agent `maxParallel` capacity checks.
- Git worktree per executable task.
- Automatic PM-driven handoff with project-level handoff rules and approval gates for LLM CLI command execution and merge.
- Provider-based platform and LLM adapters.
- Built-in LLM provider slots: mock, shell, Codex CLI, Claude Code CLI, Gemini CLI, Ollama, and OpenRouter-compatible wrappers.
- Global settings for app-wide defaults and project-local settings for default LLM backend, provider commands, agent concurrency, project concurrency, PM plan auto-start, and command approval policy.

LLM CLI providers run inside the task worktree and receive Harness context through environment variables, including `HARNESS_PROMPT_FILE`, `HARNESS_AGENT_PERSONA`, `HARNESS_TASK_TITLE`, and `HARNESS_WORKTREE_PATH`.

Shell-backed providers require human approval before their configured command runs when the current project has command approvals enabled. Pending requests appear in the Approvals panel and can be approved or rejected without losing task context.

## Development

```bash
pnpm install
pnpm dev
```

The server runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## Settings

Use the Settings panel or `/api/settings` to configure global defaults. Global settings live in the global Harness data directory and provide the starting defaults for projects.

Each project also has project-local settings stored inside `<project>/.harness/harness.db`. Use the project Settings panel or `PATCH /api/projects/:projectId/settings` to configure the current project's default LLM backend, provider command defaults, default agent concurrency, project-wide parallel run limit, PM plan auto-start behavior, command approval policy, and PM handoff rules.

Provider commands are a provider-to-command map. Agent-specific `cliCommand` values override project and global provider commands.

Handoff rules are a role-to-role map. The default routes `programmer` and `worker` completions to `reviewer`; roles without a matching rule move to Done after successful completion.

## PM Planning

Use the PM Plan panel or `POST /api/projects/:projectId/plan` to turn a goal into board tasks. The first implementation is deterministic and local: it creates requirement, design, implementation, and review tasks, assigns them by agent role, and links sequential dependencies when requested.

Set `autoStart` on the planning request or use `POST /api/projects/:projectId/schedule` to start ready tasks while respecting each agent's `maxParallel` limit and the project's `maxProjectParallel` limit.

## Task Tracking

Open a task from the board to inspect its status, assignee, worktree branch/path, dependencies, merge state, run output, errors, handoff history, and task-scoped activity timeline.

## Approvals

Harness blocks task execution before running shell-backed LLM providers until the user approves the request. Approved tasks resume automatically. Rejected tasks remain blocked with the decision recorded in the task timeline.

## Documents

Use the Documents panel to create and edit project-local notes, service plans, specs, and acceptance criteria. Documents are stored in the project-local Harness database and included in project overview state.

Selected documents can be sent to PM planning to create detailed Kanban tickets from a spec or bullet list.
