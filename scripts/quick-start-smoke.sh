#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/harness-quick-start.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT
export HARNESS_HOME="$TMP_ROOT/home"
PROJECT_PATH="$TMP_ROOT/project"
mkdir -p "$PROJECT_PATH"

run_cli() {
  pnpm --dir "$ROOT" --silent cli "$@"
}

json_value() {
  node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const parts=process.argv[2].split("."); let value=data; for (const part of parts) value=value[part]; if (value == null) process.exit(2); process.stdout.write(String(value));' "$1" "$2"
}

run_cli projects:register --path "$PROJECT_PATH" --name "Quick Start Smoke" --seedDefaults false > "$TMP_ROOT/project.json"
PROJECT_ID="$(json_value "$TMP_ROOT/project.json" project.id)"
run_cli projects:init-git --project "$PROJECT_ID" > "$TMP_ROOT/git.json"
run_cli project-settings:update --project "$PROJECT_ID" --requireCommandApproval true > "$TMP_ROOT/settings.json"
run_cli agents:create --project "$PROJECT_ID" --name "Smoke Agent" --role programmer --modelBackend shell \
  --cliCommand 'printf "Harness quick start completed\n"' --capabilities code --allowedTools shell,worktree \
  --boundaries "Stay inside the assigned worktree" > "$TMP_ROOT/agent.json"
AGENT_ID="$(json_value "$TMP_ROOT/agent.json" agent.id)"
run_cli tasks:create --project "$PROJECT_ID" --title "Verify the first Harness run" --status Selected \
  --assignee "$AGENT_ID" --workspaceMode worktree > "$TMP_ROOT/task.json"
TASK_ID="$(json_value "$TMP_ROOT/task.json" task.id)"
run_cli tasks:start --project "$PROJECT_ID" --task "$TASK_ID" > "$TMP_ROOT/start-before-approval.json"
run_cli approvals:list --project "$PROJECT_ID" --task "$TASK_ID" --status pending --kind command_execution > "$TMP_ROOT/approvals.json"
APPROVAL_ID="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.approvals.length!==1) process.exit(2); process.stdout.write(data.approvals[0].id);' "$TMP_ROOT/approvals.json")"
run_cli approvals:approve --project "$PROJECT_ID" --approval "$APPROVAL_ID" > "$TMP_ROOT/approved.json"
run_cli tasks:start --project "$PROJECT_ID" --task "$TASK_ID" > "$TMP_ROOT/start.json"

for _ in $(seq 1 50); do
  run_cli runs:list --project "$PROJECT_ID" --task "$TASK_ID" > "$TMP_ROOT/runs.json"
  if node -e 'const fs=require("node:fs"); const runs=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).runs; process.exit(runs.some((run)=>run.status==="completed")?0:1)' "$TMP_ROOT/runs.json"; then
    echo "Harness quick-start smoke passed: project=$PROJECT_ID task=$TASK_ID"
    exit 0
  fi
  sleep 0.1
done

echo "Harness quick-start smoke failed: run did not complete" >&2
cat "$TMP_ROOT/runs.json" >&2
exit 1
