# Harness MCP setup

Harness exposes the existing local application services through a versioned stdio MCP server. MCP calls do not bypass task validation, dependency checks, command approvals, workspace protection, scheduler limits, interaction resume rules, merge gates, or project writer locks.

## 1. Configure a client scope

Named clients must be registered before they can connect. An empty project list means all registered projects; otherwise only the listed project ids are visible.

```bash
pnpm --filter @harness/server cli mcp:client-save \
  --client cursor \
  --label "Cursor" \
  --read true \
  --write false \
  --projects <project-id>
```

Enable write tools only when needed:

```bash
pnpm --filter @harness/server cli mcp:client-save --client cursor --write true
```

The built-in `local-readonly` client is created as read-only on first use. Other client ids must be configured explicitly. The desktop Settings page shows client enabled/read/write/project scopes and the bridge state.

## 2. Client configuration

For an installed package, use the `harness-mcp-server` executable (`harness-mcp` is an alias):

```json
{
  "mcpServers": {
    "harness": {
      "command": "harness-mcp-server",
      "args": ["--client", "cursor"]
    }
  }
}
```

This shape can be used in Cursor, Claude Desktop, Codex, and other MCP clients that accept a stdio server command. Use each client's MCP settings location and choose a separately scoped client id when their permissions should differ.

From a source checkout, use:

```json
{
  "mcpServers": {
    "harness": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/harness",
        "--filter",
        "@harness/server",
        "mcp",
        "--",
        "--client",
        "cursor"
      ]
    }
  }
}
```

Harness uses the MCP stdio transport and writes only JSON-RPC messages to stdout. Provider login sessions remain owned by their CLI and are unrelated to MCP client authorization.

## 3. Tools and dry-run

Initial read tools:

- `list_projects`, `get_project`, `get_project_health`
- `list_tasks`, `get_task`
- `list_runs`, `get_run`
- `list_interactions`, `list_approvals`

Initial write tools:

- `create_task`, `update_task`, `comment_task`
- `schedule_task`, `decompose_task`
- `resolve_interaction`

Write tools accept `dryRun: true`. Dry-run is available to read-only clients and returns the exact shared application command/payload without mutating the project. Real writes require the client's write scope.

## 4. Desktop bridge and offline fallback

When the desktop app is active it owns a user-only Unix domain socket or Windows named pipe. MCP commands are forwarded to the desktop application service. When the bridge is offline, the MCP process calls the same application service directly; mutations must acquire the project-local writer lock.

Every call records a global MCP audit. Project-scoped calls also add `mcp.tool.succeeded` or `mcp.tool.failed` to the task/project timeline. Audit failures never turn a successful tool mutation into a failed response.

## 5. Diagnostics

```bash
pnpm --filter @harness/server cli mcp:clients
pnpm --filter @harness/server cli mcp:diagnose
```

Run a minimum read-only stdio smoke test from a source checkout:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | pnpm --filter @harness/server mcp -- --client local-readonly
```

The response must contain a `result.tools` array and must not contain an `error` object.

The diagnostic output reports the bridge address, marker, active PID, configured clients, recent calls, and the development launch command. If a named client receives `not configured`, register it first. If a write call receives `does not have write scope`, use dry-run or explicitly enable that client. If a direct fallback reports a project lock, keep the desktop running so the bridge handles the request or retry after the owning process exits.
