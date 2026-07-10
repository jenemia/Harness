# Harness

Harness is a local-first multi-agent Kanban execution framework. It starts as a local web app for fast MVP iteration and is structured so the same backend boundary can later be wrapped by a desktop shell.

## MVP

- Local project registry with project-local `.harness/` storage.
- Jira-like Kanban board.
- Agent persona management.
- Task assignment and execution.
- Git worktree per executable task.
- Automatic PM-driven handoff with risk gates reserved for merge/destructive actions.
- Mock and shell-command agent adapters.

## Development

```bash
pnpm install
pnpm dev
```

The server runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

