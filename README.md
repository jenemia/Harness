# Harness

Harness is a local-first multi-agent Kanban execution framework. It starts as a local web app for fast MVP iteration and is structured so the same backend boundary can later be wrapped by a desktop shell.

## MVP

- Local project registry with project-local `.harness/` storage.
- Jira-like Kanban board.
- Agent persona management.
- Task assignment and execution.
- PM planning endpoint that decomposes a goal into assigned Kanban tasks.
- Ready-task scheduler with agent `maxParallel` capacity checks.
- Git worktree per executable task.
- Automatic PM-driven handoff with risk gates reserved for merge/destructive actions.
- Provider-based platform and LLM adapters.
- Built-in LLM provider slots: mock, shell, Codex CLI, Claude Code CLI, Gemini CLI, Ollama, and OpenRouter-compatible wrappers.

LLM CLI providers run inside the task worktree and receive Harness context through environment variables, including `HARNESS_PROMPT_FILE`, `HARNESS_AGENT_PERSONA`, `HARNESS_TASK_TITLE`, and `HARNESS_WORKTREE_PATH`.

## Development

```bash
pnpm install
pnpm dev
```

The server runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## PM Planning

Use the PM Plan panel or `POST /api/projects/:projectId/plan` to turn a goal into board tasks. The first implementation is deterministic and local: it creates requirement, design, implementation, and review tasks, assigns them by agent role, and links sequential dependencies when requested.

Set `autoStart` on the planning request or use `POST /api/projects/:projectId/schedule` to start ready tasks while respecting each agent's `maxParallel` limit.
