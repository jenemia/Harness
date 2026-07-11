# Harness CLI reference

The CLI prints JSON and uses the same global registry, project-local `.harness/` state, validation, approvals, scheduler, locks, and audit rules as the desktop. Set `HARNESS_HOME` to isolate a test environment.

Use `pnpm cli --help` as the authoritative full option list. Common flows follow.

## Project and health

```bash
pnpm cli projects:list
pnpm cli projects:register --path ./my-project --name "My Project"
pnpm cli projects:init-git --project <projectId>
pnpm cli projects:update --project <projectId> --path ./moved-project
pnpm cli projects:report --project <projectId>
pnpm cli board:show --project <projectId>
```

## Agents, providers, and planning

```bash
pnpm cli providers:list
pnpm cli agents:create --project <projectId> --name "Frontend Agent" --role programmer \
  --modelBackend codex --capabilities frontend,react --allowedTools worktree,llm-cli,tests \
  --boundaries "Stay inside the task worktree"
pnpm cli plans:preview --project <projectId> --goal "Build the next feature" --mode sequential
pnpm cli plans:create --project <projectId> --goal "Build the next feature" --mode sequential
```

## Tasks, execution, and approvals

```bash
pnpm cli tasks:create --project <projectId> --title "Wire settings" --status Selected
pnpm cli tasks:list --project <projectId> --status Selected,Blocked
pnpm cli tasks:start --project <projectId> --task <taskId>
pnpm cli tasks:schedule --project <projectId>
pnpm cli approvals:list --project <projectId> --status pending
pnpm cli approvals:approve --project <projectId> --approval <approvalId>
pnpm cli interactions:list --project <projectId> --status pending
pnpm cli interactions:respond --project <projectId> --interaction <interactionId> \
  --action resolve --response "Proceed" --idempotencyKey <unique-key>
```

## Runs, follow-ups, and merge

```bash
pnpm cli runs:list --project <projectId> --status completed,failed,suspended
pnpm cli runs:show --project <projectId> --run <runId>
pnpm cli runs:followups --project <projectId> --run <runId>
pnpm cli tasks:merge --project <projectId> --task <taskId>
pnpm cli tasks:resolve-merge --project <projectId> --task <taskId>
pnpm cli tasks:request-changes --project <projectId> --task <taskId> --reason "Needs another pass"
```

## Agent Markdown management

```bash
pnpm cli agents:get --project <projectId> --agent <agentId>
pnpm cli agents:update --project <projectId> --agent <agentId> --expectedHash <sha256> --persona "Updated persona"
pnpm cli agents:raw-preview --project <projectId> --agent <agentId> --rawFile ./agent.md
pnpm cli agents:raw-save --project <projectId> --agent <agentId> --expectedHash <sha256> --rawFile ./agent.md
pnpm cli agents:instruction-save --project <projectId> --agent <agentId> --name security-review --expectedHash <sha256> --contentFile ./security-review.md
pnpm cli agents:clone --project <projectId> --agent <agentId> --name "Agent Copy"
pnpm cli agents:archive --project <projectId> --agent <agentId> --expectedHash <sha256> --reassignTo <replacementAgentId>
```

Agent and instruction writes require the hashes returned by `agents:get`. Archive refuses active runs and requires assigned open tasks to be reassigned or explicitly unassigned.

## Settings and MCP

```bash
pnpm cli settings:get
pnpm cli project-settings:get --project <projectId>
pnpm cli project-settings:update --project <projectId> --maxProjectParallel 3 --requireCommandApproval true --providerEventMaxCount 10000 --providerEventRetentionDays 30 --providerToolOutputMaxChars 8000
pnpm --filter @harness/server cli mcp:clients
pnpm --filter @harness/server cli mcp:diagnose
```

Use file options such as `--goalFile`, `--descriptionFile`, `--contentFile`, and `--reasonFile` for multiline input so shell quoting does not alter content.
