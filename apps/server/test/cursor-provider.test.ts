import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCursorStreamLine } from "../src/cursor-provider.js";
import { updateProjectSettings } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { listRuntimeProviders, startTask } from "../src/runtime.js";
import { createDefaultProviders } from "../src/providers.js";
import { createAgentService, createTaskService, registerProjectService } from "../src/services.js";

test("Cursor stream JSON normalizes assistant, tool, session, and terminal events", () => {
  const init = parseCursorStreamLine(JSON.stringify({
    type: "system", subtype: "init", apiKeySource: "login", cwd: "/private/project",
    session_id: "session-1", model: "gpt-5", permissionMode: "default"
  }));
  assert.deepEqual(init, {
    type: "decision",
    payload: { phase: "session_initialized", sessionId: "session-1", model: "gpt-5", permissionMode: "default" },
    metadata: { originalEventType: "system.init" }
  });
  assert.equal(JSON.stringify(init).includes("apiKeySource"), false);
  assert.equal(JSON.stringify(init).includes("/private/project"), false);

  assert.equal(parseCursorStreamLine(JSON.stringify({ type: "user", message: { content: [{ text: "private prompt" }] } })), null);
  assert.deepEqual(
    parseCursorStreamLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] }, session_id: "session-1"
    }))?.payload.text,
    "hello world"
  );

  const toolResult = parseCursorStreamLine(JSON.stringify({
    type: "tool_call", subtype: "completed", call_id: "call-1", session_id: "session-1",
    tool_call: { readToolCall: { result: { success: { content: "private file", totalLines: 2 } } } }
  }));
  assert.equal((toolResult?.payload.result as { success: { content: string } }).success.content, "[REDACTED]");

  const result = parseCursorStreamLine(JSON.stringify({
    type: "result", subtype: "success", is_error: false, result: "done", session_id: "session-1", duration_ms: 12
  }));
  assert.equal(result?.type, "result");
  assert.equal(result?.payload.summary, "done");
  assert.equal(parseCursorStreamLine("not json"), null);
});

test("Cursor CLI provider uses login session, default stream command, timeout, and common run events", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-cursor-provider-"));
  const previousHome = process.env.HARNESS_HOME;
  const previousPath = process.env.PATH;
  process.env.HARNESS_HOME = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const executable = path.join(bin, "cursor-agent");
  const argumentLog = path.join(root, "cursor-arguments.log");
  const codexArgumentLog = path.join(root, "codex-arguments.log");
  process.env.HARNESS_TEST_CURSOR_ARGUMENT_LOG = argumentLog;
  process.env.HARNESS_TEST_CODEX_ARGUMENT_LOG = codexArgumentLog;
  writeFileSync(executable, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'cursor-agent 1.2.3'; exit 0; fi",
    "if [ \"$1\" = \"status\" ]; then echo 'Logged in'; exit 0; fi",
    "printf '%s\\n' \"$*\" >> \"$HARNESS_TEST_CURSOR_ARGUMENT_LOG\"",
    "if [ \"$1\" = \"--resume\" ]; then exit 1; fi",
    "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"apiKeySource\":\"login\",\"cwd\":\"/private\",\"session_id\":\"session-1\",\"model\":\"test-model\",\"permissionMode\":\"default\"}'",
    "printf '%s\\n' '{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"private prompt\"}]},\"session_id\":\"session-1\"}'",
    "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Cursor completed the task.\"}]},\"session_id\":\"session-1\"}'",
    "printf '%s\\n' '{\"type\":\"tool_call\",\"subtype\":\"started\",\"call_id\":\"call-1\",\"tool_call\":{\"readToolCall\":{\"args\":{\"path\":\"README.md\"}}},\"session_id\":\"session-1\"}'",
    "printf '%s\\n' '{\"type\":\"tool_call\",\"subtype\":\"completed\",\"call_id\":\"call-1\",\"tool_call\":{\"readToolCall\":{\"result\":{\"success\":{\"content\":\"private file\",\"totalLines\":1}}}},\"session_id\":\"session-1\"}'",
    "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"duration_ms\":8,\"result\":\"Cursor completed the task.\",\"session_id\":\"session-1\"}'"
  ].join("\n"), "utf8");
  chmodSync(executable, 0o755);
  const codexExecutable = path.join(bin, "codex");
  writeFileSync(codexExecutable, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'codex 1.0'; exit 0; fi",
    "printf '%s\\n' \"$*\" >> \"$HARNESS_TEST_CODEX_ARGUMENT_LOG\"",
    "if [ \"$2\" = \"resume\" ]; then exit 1; fi",
    "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread-new\"}'",
    "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Codex completed the task.\"}}'"
  ].join("\n"), "utf8");
  chmodSync(codexExecutable, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`;

  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    updateProjectSettings(project.path, { requireCommandApproval: false, maxRunSeconds: 5 });
    const agent = createAgentService(project, {
      name: "Cursor Worker",
      role: "worker",
      persona: "Use Cursor safely.",
      modelBackend: "mock",
      allowedTools: ["cursor-cli"],
      boundaries: "Stay in the task workspace."
    });
    const task = createTaskService(project, {
      title: "Cursor stream run",
      assigneeAgentId: agent.id,
      modelBackend: "cursor-cli",
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, task.id)).accepted, true);
    const overview = await waitForTerminalRun(() => getProjectOverview(project));
    const run = overview.runs.find((item) => item.taskId === task.id);
    assert.equal(run?.status, "completed");
    assert.equal(run?.providerId, "cursor-cli");
    assert.match(run?.commandPreview || "", /--output-format stream-json/);
    assert.match(run?.output || "", /Cursor completed/);

    const events = overview.providerEvents.filter((event) => event.runId === run?.id).reverse();
    assert.deepEqual(events.map((event) => event.type), ["decision", "text_delta", "tool_use", "tool_result", "result"]);
    assert.equal(JSON.stringify(events).includes("private prompt"), false);
    assert.equal(JSON.stringify(events).includes("private file"), false);
    assert.equal(events.find((event) => event.type === "result")?.payload.sessionId, "session-1");

    const catalog = listRuntimeProviders();
    const cursor = catalog.llmProviders.find((provider) => provider.id === "cursor-cli");
    assert.equal(cursor?.authenticationStatus?.installed, true);
    assert.equal(cursor?.authenticationStatus?.authenticated, true);
    assert.equal(cursor?.capabilities.streaming, true);
    assert.equal(cursor?.capabilities.sessionResume, true);
    assert.equal(cursor?.capabilities.toolEvents, true);

    const providers = createDefaultProviders((projectPath) => path.join(projectPath, ".harness"));
    const incomplete = await providers.llm("cursor-cli").run(
      { ...agent, cliCommand: `printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}'` },
      task,
      { kind: "harness", branchName: null, worktreePath: run?.worktreePath || project.path },
      { globalMemory: [], projectMemory: [], timeoutMs: 1000 }
    );
    assert.equal(incomplete.ok, false);
    assert.match(incomplete.error || "", /without a successful result/i);
    const timedOut = await providers.llm("cursor-cli").run(
      { ...agent, cliCommand: "sleep 1" },
      task,
      { kind: "harness", branchName: null, worktreePath: run?.worktreePath || project.path },
      { globalMemory: [], projectMemory: [], timeoutMs: 20 }
    );
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.error || "", /timed out/i);

    const decisions: string[] = [];
    const resumed = await providers.llm("cursor-cli").run(
      { ...agent, cliCommand: 'cursor-agent -p --force --output-format stream-json < "$HARNESS_PROMPT_FILE"' },
      task,
      { kind: "harness", branchName: null, worktreePath: run?.worktreePath || project.path },
      { globalMemory: [], projectMemory: [], timeoutMs: 1000, resumeSession: { sessionId: "session-old", parentRunId: "run-old" }, onEvent: (event) => {
        if (event.type === "decision" && typeof event.payload.phase === "string") decisions.push(event.payload.phase);
      } }
    );
    assert.equal(resumed.ok, true);
    assert.deepEqual(decisions, ["session_fallback", "session_initialized"]);
    const invocations = readFileSync(argumentLog, "utf8").trim().split("\n");
    assert.match(invocations.at(-2) || "", /^--resume session-old /);
    assert.doesNotMatch(invocations.at(-1) || "", /--resume/);

    const codexDecisions: string[] = [];
    const codex = await providers.llm("codex-5.6-sol").run(
      agent,
      task,
      { kind: "harness", branchName: null, worktreePath: run?.worktreePath || project.path },
      { globalMemory: [], projectMemory: [], timeoutMs: 1000, resumeSession: { sessionId: "thread-old", parentRunId: "run-old" }, onEvent: (event) => {
        if (event.type === "decision" && typeof event.payload.phase === "string") codexDecisions.push(event.payload.phase);
      } }
    );
    assert.equal(codex.ok, true);
    assert.match(codex.output, /Codex completed/);
    assert.deepEqual(codexDecisions, ["session_fallback", "session_initialized"]);
    const codexInvocations = readFileSync(codexArgumentLog, "utf8").trim().split("\n").filter((line) => line.startsWith("exec "));
    assert.match(codexInvocations[0], /^exec resume --json --model gpt-5\.6-codex-sol thread-old -$/);
    assert.match(codexInvocations[1], /^exec --json --sandbox workspace-write --model gpt-5\.6-codex-sol -$/);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.HARNESS_TEST_CURSOR_ARGUMENT_LOG;
    delete process.env.HARNESS_TEST_CODEX_ARGUMENT_LOG;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForTerminalRun(overview: () => ReturnType<typeof getProjectOverview>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = overview();
    if (value.runs.some((run) => run.status !== "running")) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for Cursor provider run.");
}
