# Harness

Harness is a local-first multi-agent Kanban execution framework. It starts as a local web app for fast MVP iteration and is structured so the same backend boundary can later be wrapped by a desktop shell.

## MVP

- Local project registry with project-local `.harness/` storage.
- Jira-like Kanban board.
- Jira-like task detail drawer with task metadata, dependencies, runs, timeline, worktree, and merge state.
- Project-local Documents panel for specs, notes, and planning material.
- Agent persona management.
- Task assignment and execution.
- PM planning endpoint that decomposes a goal into assigned Kanban tasks.
- Ready-task scheduler with agent `maxParallel` capacity checks.
- Git worktree per executable task.
- Automatic PM-driven handoff with approval gates for LLM CLI command execution and merge.
- Provider-based platform and LLM adapters.
- Built-in LLM provider slots: mock, shell, Codex CLI, Claude Code CLI, Gemini CLI, Ollama, and OpenRouter-compatible wrappers.
- Global settings for default project root, default LLM backend, default agent concurrency, and PM plan auto-start.

LLM CLI providers run inside the task worktree and receive Harness context through environment variables, including `HARNESS_PROMPT_FILE`, `HARNESS_AGENT_PERSONA`, `HARNESS_TASK_TITLE`, and `HARNESS_WORKTREE_PATH`.

Non-mock providers require human approval before their configured shell command runs. Pending requests appear in the Approvals panel and can be approved or rejected without losing task context.

## Development

```bash
pnpm install
pnpm dev
```

The server runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## Settings

Use the Settings panel or `/api/settings` to configure global defaults. These settings live in the global Harness data directory and are applied when creating new agents or planning new work.

## PM Planning

Use the PM Plan panel or `POST /api/projects/:projectId/plan` to turn a goal into board tasks. The first implementation is deterministic and local: it creates requirement, design, implementation, and review tasks, assigns them by agent role, and links sequential dependencies when requested.

Set `autoStart` on the planning request or use `POST /api/projects/:projectId/schedule` to start ready tasks while respecting each agent's `maxParallel` limit.

## Task Tracking

Open a task from the board to inspect its status, assignee, worktree branch/path, dependencies, merge state, run output, errors, and task-scoped activity timeline.

## Approvals

Harness blocks task execution before running shell-backed LLM providers until the user approves the request. Approved tasks resume automatically. Rejected tasks remain blocked with the decision recorded in the task timeline.

## Documents

Use the Documents panel to create and edit project-local notes, service plans, specs, and acceptance criteria. Documents are stored in the project-local Harness database and included in project overview state.

Selected documents can be sent to PM planning to create detailed Kanban tickets from a spec or bullet list.
