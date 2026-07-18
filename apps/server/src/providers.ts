import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import type { ProviderCapabilities, ProviderEventType } from "@harness/core";
import type { DirectProviderOAuthDefinition } from "./direct-provider-auth.js";
import type { AgentRecord, ApprovalRecord, CommentRecord, MemoryRecord, ProjectSettings, RunRecord, TaskRecord } from "./types.js";
import { parseCursorStreamLine } from "./cursor-provider.js";

export type CommandResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type TaskWorkspace = {
  kind: "git-worktree" | "harness";
  branchName: string | null;
  worktreePath: string;
};

export type MergeState = {
  inProgress: boolean;
  branchMerged: boolean;
  status: string;
  unmergedFiles: string[];
};

export type LlmRunContext = {
  responseLocale?: "ko" | "en";
  globalMemory: MemoryRecord[];
  projectMemory: MemoryRecord[];
  skipGitRepoCheck?: boolean;
  taskComments?: CommentRecord[];
  taskRuns?: RunRecord[];
  agentDefinitionSnapshot?: string;
  timeoutMs?: number;
  resume?: {
    interactionId: string;
    parentRunId: string;
    correlationId: string;
    responsePayload: Record<string, unknown>;
    checkpoint: Record<string, unknown> | null;
  };
  resumeSession?: { sessionId: string; parentRunId: string };
  workspaceProtection?: {
    canonicalWorkspacePath: string;
    pushExceptionToken?: string;
  };
  onEvent?: (event: { type: ProviderEventType; payload: Record<string, unknown>; metadata?: { originalEventType?: string } }) => void;
};

export type ProviderRunStatus = "completed" | "failed" | "suspended";

export type ProviderInteractionRequest = {
  kind: "question" | "approval" | "permission" | "review";
  requestPayload: Record<string, unknown>;
  checkpoint?: Record<string, unknown> | null;
  expiresAt?: string | null;
};

export type LlmRunResult = {
  status: ProviderRunStatus;
  ok: boolean;
  output: string;
  error: string | null;
  interaction?: ProviderInteractionRequest;
  completion?: {
    summary: string;
    acceptanceCriteria: Array<{ criterion: string; met: boolean; evidence: string }>;
    decisions: string[];
    validations: Array<{ kind: "test" | "typecheck" | "lint" | "build"; ran: boolean; passed: boolean; evidence: string }>;
    limitations: string[];
    followUps: string[];
  };
};

export type PlatformProvider = {
  id: string;
  label: string;
  platform: NodeJS.Platform;
  capabilities: {
    shell: string;
    processGroups: boolean;
  };
  run(command: string, args: string[], cwd: string, allowFailure?: boolean): Promise<CommandResult>;
  runShell(command: string, cwd: string, extraEnv: Record<string, string>, timeoutMs?: number): Promise<{ ok: boolean; output: string; error: string | null }>;
  runShellLines(
    command: string,
    cwd: string,
    extraEnv: Record<string, string>,
    timeoutMs: number | undefined,
    onStdoutLine: (line: string) => void,
    onStderrLine?: (line: string) => void
  ): Promise<{ ok: boolean; code: number | null; error: string | null }>;
};

export type WorkspaceProvider = {
  id: string;
  label: string;
  kind: "git-worktree";
  description: string;
  capabilities: {
    isolatedTaskWorkspace: boolean;
    gitWorktrees: boolean;
    harnessWorkspaces: boolean;
    branchPerTask: boolean;
    mergeIntoMainCheckout: boolean;
  };
  initializeProject(projectPath: string): Promise<{ initialized: boolean; committed: boolean; head: string | null; output: string }>;
  ensureGitReady(projectPath: string): Promise<void>;
  ensureTaskWorkspace(projectPath: string, task: TaskRecord): Promise<TaskWorkspace>;
  commitAll(cwd: string, message: string): Promise<{ committed: boolean; output: string; error: string | null; commitSha: string | null; parentSha: string | null }>;
  mergeBranch(projectPath: string, branchName: string, message: string): Promise<CommandResult>;
  mergeState(projectPath: string, branchName: string): Promise<MergeState>;
  finalizeMerge(projectPath: string): Promise<CommandResult>;
  abortMerge(projectPath: string): Promise<CommandResult>;
  workingTreeStatus(projectPath: string): Promise<string>;
  snapshotRef(cwd: string): Promise<string>;
  changedFiles(cwd: string): Promise<string[]>;
  localBranches(projectPath: string): Promise<{ current: string; branches: string[] }>;
  checkoutBranch(projectPath: string, branchName: string): Promise<CommandResult>;
  removeWorktree(projectPath: string, worktreePath: string): Promise<CommandResult>;
};

export type LlmProvider = {
  id: string;
  definition: LlmProviderDefinition;
  run(
    agent: AgentRecord,
    task: TaskRecord,
    workspace: TaskWorkspace,
    context?: LlmRunContext
  ): Promise<LlmRunResult>;
};

export type LlmProviderDefinition = {
  id: string;
  label: string;
  kind: "mock" | "generic-shell" | "llm-cli" | "direct-api";
  description: string;
  requiresCommand: boolean;
  commandExample: string | null;
  defaultCommand?: string | null;
  capabilities: ProviderCapabilities;
  authentication?: CliAuthenticationDefinition;
  directAuthentication?: DirectProviderOAuthDefinition;
};

const nonStreamingCapabilities: ProviderCapabilities = {
  streaming: false,
  sessionResume: false,
  toolEvents: false,
  diffEvents: false,
  usageEvents: false,
  structuredDecision: false,
  gracefulStop: false
};

export type CliAuthenticationDefinition = {
  strategy: "cli-session";
  executable: string;
  versionArgs: string[];
  statusArgs: string[];
  loginCommand: string;
};

export function diagnoseCliAuthentication(authentication: CliAuthenticationDefinition) {
  const version = spawnSync(authentication.executable, authentication.versionArgs, { encoding: "utf8", timeout: 3000 });
  if (version.error && (version.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { installed: false, authenticated: false, version: null, loginCommand: authentication.loginCommand, message: `${authentication.executable} is not installed or not on PATH.` };
  }
  const status = spawnSync(authentication.executable, authentication.statusArgs, { encoding: "utf8", timeout: 3000 });
  return {
    installed: version.status === 0,
    authenticated: status.status === 0,
    version: version.status === 0 ? (version.stdout || version.stderr).trim().split(/\r?\n/)[0] || null : null,
    loginCommand: authentication.loginCommand,
    message: status.status === 0 ? "Existing CLI login session is available." : `Run ${authentication.loginCommand} in a terminal, then retry.`
  };
}

export type OllamaRuntimeStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: Array<{ name: string; id: string | null; size: string | null; modifiedAt: string | null }>;
  error: string | null;
};

export function parseOllamaListOutput(output: string): OllamaRuntimeStatus["models"] {
  return output.trim().split(/\r?\n/).slice(1).map((line) => {
    const [name, id, size, modifiedAt] = line.trim().split(/\s{2,}/);
    return name ? { name, id: id || null, size: size || null, modifiedAt: modifiedAt || null } : null;
  }).filter((model): model is OllamaRuntimeStatus["models"][number] => Boolean(model));
}

export function diagnoseOllamaRuntime(): OllamaRuntimeStatus {
  const version = spawnSync("ollama", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (version.error && (version.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { installed: false, running: false, version: null, models: [], error: "Ollama is not installed or not on PATH." };
  }
  const list = spawnSync("ollama", ["list"], { encoding: "utf8", timeout: 5000 });
  const installed = version.status === 0;
  const running = list.status === 0;
  return {
    installed,
    running,
    version: installed ? (version.stdout || version.stderr).trim().split(/\r?\n/)[0] || null : null,
    models: running ? parseOllamaListOutput(list.stdout) : [],
    error: running ? null : (list.stderr || list.stdout || "Ollama service is not running. Run ollama serve, then retry.").trim()
  };
}

export async function probeOllamaModel(model: string) {
  const configuredHost = process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
  const host = /^https?:\/\//i.test(configuredHost) ? configuredHost : `http://${configuredHost}`;
  try {
    const response = await fetch(new URL("/api/generate", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "Reply exactly OK.",
        stream: false,
        think: false,
        options: { num_predict: 8 }
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const payload = await response.json() as { response?: unknown; error?: unknown };
    if (!response.ok) {
      return { ok: false, error: typeof payload.error === "string" ? payload.error : `Ollama returned HTTP ${response.status}.` };
    }
    return typeof payload.response === "string" && payload.response.trim()
      ? { ok: true, error: null }
      : { ok: false, error: "Ollama returned an empty model response." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ollamaCommand(model: string) {
  return `ollama run ${shellQuote(model)} < "$HARNESS_PROMPT_FILE"`;
}

export function parseOllamaModelFromCommand(command: string | null | undefined) {
  const match = command?.match(/(?:^|\s)ollama\s+run\s+(?:'([^']+)'|"([^"]+)"|([^\s<]+))/);
  return match?.[1] || match?.[2] || match?.[3] || null;
}

export type ProviderCommandResolution = {
  command: string | null;
  source: "agent" | "settings" | "provider" | "none";
  key: string | null;
  candidateKeys: string[];
  platformProviderId: string;
  nodePlatform: NodeJS.Platform;
};

export function providerCommandCandidateKeys(platformProvider: PlatformProvider, modelBackend: string) {
  return [
    `${platformProvider.id}.${modelBackend}`,
    `${platformProvider.platform}.${modelBackend}`,
    modelBackend
  ];
}

export type ApprovalProviderDefinition = {
  id: string;
  label: string;
  kind: "local-human";
  description: string;
  capabilities: {
    commandExecution: boolean;
    mergeApproval: boolean;
    handoffApproval: boolean;
    remembersDecisions: boolean;
    resumesApprovedTasks: boolean;
  };
};

export type PolicyProviderDefinition = {
  id: string;
  label: string;
  kind: "local-agent-policy";
  description: string;
  capabilities: {
    llmCommandPermission: boolean;
    providerSpecificTools: boolean;
    boundaryPromptInjection: boolean;
    riskyCommandApproval: boolean;
    workspaceBoundary: boolean;
    prePushGuard: boolean;
  };
};

export type CommandApprovalEvaluation =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | {
      action: "request";
      reason: string;
      commandPreview: string | null;
      metadata: Record<string, string | null>;
    };

export type MergeApprovalEvaluation =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | {
      action: "request";
      reason: string;
      metadata: Record<string, string | null>;
    };

export type PolicyEvaluation =
  | { action: "allow" }
  | {
      action: "block";
      reason: string;
      metadata: Record<string, string | null>;
    };

export type CommandRiskEvaluation = {
  requiresApproval: boolean;
  reason: string | null;
  tags: string[];
  metadata: Record<string, string | null>;
};

export type ApprovalProvider = {
  id: string;
  definition: ApprovalProviderDefinition;
  evaluateCommandExecution(input: {
    required: boolean;
    riskReason: string | null;
    riskTags: string[];
    task: TaskRecord;
    agent: AgentRecord;
    llmProvider: LlmProviderDefinition;
    effectiveBackend: string;
    commandPreview: string | null;
    existingApprovals: ApprovalRecord[];
  }): CommandApprovalEvaluation;
  evaluateMerge(input: {
    task: TaskRecord;
    agent: AgentRecord;
    existingApprovals: ApprovalRecord[];
  }): MergeApprovalEvaluation;
  decisionMessage(decision: "approved" | "rejected", approval: ApprovalRecord): string;
  rejectionReason(approval: ApprovalRecord): string;
};

export type PolicyProvider = {
  id: string;
  definition: PolicyProviderDefinition;
  evaluateLlmExecution(input: {
    task: TaskRecord;
    agent: AgentRecord;
    llmProvider: LlmProviderDefinition;
    effectiveBackend: string;
    commandPreview: string | null;
  }): PolicyEvaluation;
  evaluateCommandRisk(input: {
    task: TaskRecord;
    agent: AgentRecord;
    llmProvider: LlmProviderDefinition;
    effectiveBackend: string;
    commandPreview: string | null;
  }): CommandRiskEvaluation;
};

export class ProviderRegistry {
  constructor(
    private readonly platformProvider: PlatformProvider,
    private readonly workspaceProvider: WorkspaceProvider,
    private readonly approvalProvider: ApprovalProvider,
    private readonly policyProvider: PolicyProvider,
    private readonly llmProviders: LlmProvider[]
  ) {}

  platform() {
    return this.platformProvider;
  }

  workspace() {
    return this.workspaceProvider;
  }

  approval() {
    return this.approvalProvider;
  }

  policy() {
    return this.policyProvider;
  }

  llm(modelBackend: string) {
    return this.llmProviders.find((provider) => provider.id === modelBackend) ?? this.llmProviders[0];
  }

  llmDefinitions() {
    return this.llmProviders.map((provider) => provider.definition);
  }
}

export function resolveProviderCommand(
  platformProvider: PlatformProvider,
  agent: Pick<AgentRecord, "cliCommand">,
  modelBackend: string,
  settings: Pick<ProjectSettings, "providerCommands">,
  defaultCommand?: string | null
): ProviderCommandResolution {
  const commandKeys = providerCommandCandidateKeys(platformProvider, modelBackend);
  if (agent.cliCommand) {
    return {
      command: agent.cliCommand,
      source: "agent",
      key: "agent.cliCommand",
      candidateKeys: commandKeys,
      platformProviderId: platformProvider.id,
      nodePlatform: platformProvider.platform
    };
  }
  const matchingKey = commandKeys.find((key) => settings.providerCommands[key]?.trim());
  const providerCommand = defaultCommand?.trim() || null;
  return {
    command: matchingKey ? settings.providerCommands[matchingKey] : providerCommand,
    source: matchingKey ? "settings" : providerCommand ? "provider" : "none",
    key: matchingKey || (providerCommand ? "provider.defaultCommand" : null),
    candidateKeys: commandKeys,
    platformProviderId: platformProvider.id,
    nodePlatform: platformProvider.platform
  };
}

export function providerCommandMetadata(resolution: ProviderCommandResolution) {
  return {
    providerCommandSource: resolution.source,
    providerCommandKey: resolution.key,
    platformProviderId: resolution.platformProviderId,
    nodePlatform: resolution.nodePlatform
  };
}

export function createDefaultProviders(projectHarnessDir: (projectPath: string) => string) {
  const platformProvider = createPlatformProvider();
  const workspaceProvider = createGitWorktreeWorkspaceProvider(platformProvider, projectHarnessDir);
  const approvalProvider = createLocalHumanApprovalProvider();
  const policyProvider = createLocalAgentPolicyProvider();
  return new ProviderRegistry(platformProvider, workspaceProvider, approvalProvider, policyProvider, [
    createMockLlmProvider(),
    createShellLlmProvider(platformProvider),
    createCursorCliProvider(platformProvider),
    ...createCodexCliProviders(platformProvider),
    createCliLlmProvider(platformProvider, {
      id: "claude",
      label: "Claude Code CLI",
      description: "Runs Claude Code CLI with its existing user login session inside the task workspace.",
      commandExample: "claude -p \"$(cat $HARNESS_PROMPT_FILE)\"",
      defaultCommand: "claude -p \"$(cat $HARNESS_PROMPT_FILE)\"",
      authentication: { strategy: "cli-session", executable: "claude", versionArgs: ["--version"], statusArgs: ["auth", "status"], loginCommand: "claude login" }
    }),
    createCliLlmProvider(platformProvider, {
      id: "gemini",
      label: "Gemini CLI",
      description: "Runs a user-configured Gemini CLI command inside the task workspace.",
      commandExample: "gemini -p \"$(cat $HARNESS_PROMPT_FILE)\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "ollama",
      label: "Ollama",
      description: "Runs an installed local Ollama model inside the task workspace.",
      commandExample: "ollama run llama3.1 \"$(cat $HARNESS_PROMPT_FILE)\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "openrouter",
      label: "OpenRouter Wrapper",
      description: "Runs any user-provided OpenRouter-compatible local CLI wrapper.",
      commandExample: "openrouter-cli run --prompt-file \"$HARNESS_PROMPT_FILE\""
    })
  ]);
}

function createCodexCliProviders(platformProvider: PlatformProvider) {
  const authentication: CliAuthenticationDefinition = {
    strategy: "cli-session",
    executable: "codex",
    versionArgs: ["--version"],
    statusArgs: ["login", "status"],
    loginCommand: "codex login"
  };
  const models = [
    ["codex", "Codex CLI (default)", null],
    ["codex-5.5", "Codex · GPT-5.5", "gpt-5.5-codex"],
    ["codex-5.6-sol", "Codex · GPT-5.6 Sol", "gpt-5.6-codex-sol"],
    ["codex-5.6-terra", "Codex · GPT-5.6 Terra", "gpt-5.6-codex-terra"],
    ["codex-5.6-luna", "Codex · GPT-5.6 Luna", "gpt-5.6-codex-luna"]
  ] as const;

  return models.map(([id, label, model]) => createCodexCliProvider(platformProvider, {
    id,
    label,
    description: "Runs Codex CLI with its existing user login session inside the task workspace.",
    commandExample: codexCommand(model),
    defaultCommand: codexCommand(model),
    authentication
  }));
}

function createCodexCliProvider(
  platformProvider: PlatformProvider,
  input: Omit<LlmProviderDefinition, "kind" | "requiresCommand" | "capabilities"> & { id: string; defaultCommand?: string | null }
): LlmProvider {
  const modelById: Record<string, string> = {
    "codex-5.5": "gpt-5.5-codex",
    "codex-5.6-sol": "gpt-5.6-codex-sol",
    "codex-5.6-terra": "gpt-5.6-codex-terra",
    "codex-5.6-luna": "gpt-5.6-codex-luna"
  };
  const model = modelById[input.id] || null;
  return {
    id: input.id,
    definition: {
      ...input,
      kind: "llm-cli",
      requiresCommand: true,
      capabilities: { ...nonStreamingCapabilities, streaming: true, sessionResume: true }
    },
    async run(agent, task, workspace, context) {
      let output = "";
      let sessionId = context?.resumeSession?.sessionId || "";
      const resumeCommand = context?.resumeSession
        ? ["codex exec resume --json", model ? `--model ${shellQuote(model)}` : "", shellQuote(sessionId), `- < \"$HARNESS_PROMPT_FILE\"`].filter(Boolean).join(" ")
        : null;
      const freshCommand = [
        "codex exec --json --sandbox workspace-write",
        context?.skipGitRepoCheck ? "--skip-git-repo-check" : "",
        model ? `--model ${shellQuote(model)}` : "",
        `- < \"$HARNESS_PROMPT_FILE\"`
      ].filter(Boolean).join(" ");
      const invoke = (command: string) => platformProvider.runShellLines(
          command, workspace.worktreePath, buildLlmEnvironment(input.id, agent, task, workspace, context), context?.timeoutMs,
          (line) => {
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              if (event.type === "thread.started" && typeof event.thread_id === "string") {
                sessionId = event.thread_id;
                context?.onEvent?.({ type: "decision", payload: { phase: "session_initialized", sessionId } });
              }
              const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : null;
              if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
                output += item.text;
                context?.onEvent?.({ type: "text_delta", payload: { text: item.text, sessionId } });
              }
            } catch { /* subprocess status remains authoritative */ }
          });
      let result = await invoke(resumeCommand || freshCommand);
      if (!result.ok && resumeCommand) {
        output = "";
        context?.onEvent?.({ type: "decision", payload: { phase: "session_fallback", sessionId: context?.resumeSession?.sessionId } });
        result = await invoke(freshCommand);
      }
      return { status: result.ok ? "completed" : "failed", ok: result.ok, output, error: result.ok ? null : result.error };
    }
  };
}

export function codexCommand(model: string | null) {
  return ["codex exec", model ? `--model ${model}` : "", "--sandbox workspace-write", "- < \"$HARNESS_PROMPT_FILE\""]
    .filter(Boolean)
    .join(" ");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function createLocalAgentPolicyProvider(): PolicyProvider {
  return {
    id: "local-agent-policy",
    definition: {
      id: "local-agent-policy",
      label: "Local Agent Policy",
      kind: "local-agent-policy",
      description: "Checks agent tool boundaries before a model provider can execute.",
      capabilities: {
        llmCommandPermission: true,
        providerSpecificTools: true,
        boundaryPromptInjection: true,
        riskyCommandApproval: true,
        workspaceBoundary: true,
        prePushGuard: true
      }
    },

    evaluateLlmExecution(input) {
      if (!input.llmProvider.requiresCommand) {
        return { action: "allow" };
      }

      const allowedTools = new Set(input.agent.allowedTools.map((tool) => tool.toLowerCase()));
      const acceptedTools = [
        "shell",
        "llm-cli",
        input.llmProvider.kind,
        input.llmProvider.id,
        input.effectiveBackend
      ].map((tool) => tool.toLowerCase());
      const hasCommandPermission = acceptedTools.some((tool) => allowedTools.has(tool));
      if (hasCommandPermission) {
        return { action: "allow" };
      }

      const reason = `${input.agent.name} is not allowed to run ${input.llmProvider.label}. Add one of these allowed tools: ${acceptedTools.join(", ")}.`;
      return {
        action: "block",
        reason,
        metadata: {
          policyProvider: this.id,
          provider: input.llmProvider.id,
          effectiveBackend: input.effectiveBackend,
          commandPreview: input.commandPreview,
          allowedTools: input.agent.allowedTools.join(",")
        }
      };
    },

    evaluateCommandRisk(input) {
      const baseMetadata = {
        policyProvider: this.id,
        riskTags: null,
        commandPreview: input.commandPreview,
        provider: input.llmProvider.id,
        effectiveBackend: input.effectiveBackend
      };
      if (!input.llmProvider.requiresCommand || !input.commandPreview) {
        return { requiresApproval: false, reason: null, tags: [], metadata: baseMetadata };
      }

      const risks = detectRiskyCommand(input.commandPreview);
      if (risks.length === 0) {
        return { requiresApproval: false, reason: null, tags: [], metadata: baseMetadata };
      }

      return {
        requiresApproval: true,
        reason: `Risky command policy requires approval before running: ${risks.map((risk) => risk.label).join(", ")}.`,
        tags: risks.map((risk) => risk.tag),
        metadata: {
          policyProvider: this.id,
          riskTags: risks.map((risk) => risk.tag).join(","),
          commandPreview: input.commandPreview,
          provider: input.llmProvider.id,
          effectiveBackend: input.effectiveBackend
        }
      };
    }
  };
}

export function detectRiskyCommand(command: string) {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  const patterns: Array<{ tag: string; label: string; regex: RegExp }> = [
    { tag: "destructive-delete", label: "recursive forced delete", regex: /\brm\s+-[^\n;|&]*r[^\n;|&]*f|\brm\s+-[^\n;|&]*f[^\n;|&]*r/i },
    { tag: "git-reset-hard", label: "hard Git reset", regex: /\bgit\s+reset\s+--hard\b/i },
    { tag: "git-clean", label: "Git clean", regex: /\bgit\s+clean\s+-[^\n;|&]*[fdx]/i },
    { tag: "git-push", label: "Git push", regex: /\bgit\s+push\b/i },
    { tag: "git-merge", label: "Git merge or rebase", regex: /\bgit\s+(?:merge|rebase)\b/i },
    { tag: "elevated-permission", label: "sudo", regex: /\bsudo\b/i },
    { tag: "package-install", label: "package install or update", regex: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|uv|cargo|go)\s+(?:install|add|get)\b/i },
    { tag: "remote-shell", label: "remote script piped to shell", regex: /\b(?:curl|wget)\b[^;&]*\|\s*(?:sh|bash|zsh)\b/i }
  ];
  return patterns.filter((pattern) => pattern.regex.test(normalized));
}

function createPlatformProvider(): PlatformProvider {
  if (process.platform === "darwin") {
    return createNodePlatformProvider({
      id: "node-darwin",
      label: "Node macOS Platform",
      shell: process.env.SHELL || "/bin/zsh",
      processGroups: true
    });
  }

  if (process.platform === "win32") {
    return createNodePlatformProvider({
      id: "node-win32",
      label: "Node Windows Platform",
      shell: process.env.ComSpec || "cmd.exe",
      processGroups: false
    });
  }

  return createNodePlatformProvider({
    id: `node-${process.platform}`,
    label: `Node ${process.platform} Platform`,
    shell: process.env.SHELL || "/bin/sh",
    processGroups: true
  });
}

function createNodePlatformProvider(
  config: {
    id: string;
    label: string;
    shell: string;
    processGroups: boolean;
  }
): PlatformProvider {
  return {
    id: config.id,
    label: config.label,
    platform: process.platform,
    capabilities: {
      shell: config.shell,
      processGroups: config.processGroups
    },

    run,

    async runShell(command, cwd, extraEnv, timeoutMs) {
      const result = await new Promise<{ code: number | null; output: string; error: string; timedOut: boolean }>((resolve) => {
        const child = spawn(command, {
          cwd,
          shell: config.shell,
          env: { ...process.env, ...extraEnv },
          detached: config.processGroups
        });
        let output = "";
        let error = "";
        let timedOut = false;
        let closed = false;
        const timeout = timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              killShellProcess(child.pid, "SIGTERM", config.processGroups);
              setTimeout(() => {
                if (!closed) {
                  killShellProcess(child.pid, "SIGKILL", config.processGroups);
                }
              }, 1000);
            }, timeoutMs)
          : null;

        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          error += chunk.toString();
        });
        child.on("close", (code) => {
          closed = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          resolve({ code, output, error, timedOut });
        });
      });

      return {
        ok: result.code === 0 && !result.timedOut,
        output: result.output,
        error: result.timedOut
          ? `Command timed out after ${Math.round((timeoutMs || 0) / 1000)} seconds.`
          : result.error || (result.code === 0 ? null : `Command exited with code ${result.code}`)
      };
    },

    async runShellLines(command, cwd, extraEnv, timeoutMs, onStdoutLine, onStderrLine) {
      return new Promise((resolve) => {
        const child = spawn(command, {
          cwd,
          shell: config.shell,
          env: { ...process.env, ...extraEnv },
          detached: config.processGroups
        });
        let stderr = "";
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let timedOut = false;
        let closed = false;
        const emitLines = (chunk: string, current: string, listener?: (line: string) => void) => {
          const parts = `${current}${chunk}`.split(/\r?\n/);
          const remainder = parts.pop() || "";
          for (const line of parts) {
            if (line) listener?.(line);
          }
          return remainder;
        };
        const timeout = timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              killShellProcess(child.pid, "SIGTERM", config.processGroups);
              setTimeout(() => {
                if (!closed) killShellProcess(child.pid, "SIGKILL", config.processGroups);
              }, 1000);
            }, timeoutMs)
          : null;
        child.stdout.on("data", (chunk) => {
          stdoutBuffer = emitLines(chunk.toString(), stdoutBuffer, onStdoutLine);
        });
        child.stderr.on("data", (chunk) => {
          const value = chunk.toString();
          stderr += value;
          stderrBuffer = emitLines(value, stderrBuffer, onStderrLine);
        });
        child.on("close", (code) => {
          closed = true;
          if (timeout) clearTimeout(timeout);
          if (stdoutBuffer) onStdoutLine(stdoutBuffer);
          if (stderrBuffer) onStderrLine?.(stderrBuffer);
          resolve({
            ok: code === 0 && !timedOut,
            code,
            error: timedOut
              ? `Command timed out after ${Math.round((timeoutMs || 0) / 1000)} seconds.`
              : stderr.trim() || (code === 0 ? null : `Command exited with code ${code}`)
          });
        });
      });
    }
  };
}

function createGitWorktreeWorkspaceProvider(
  platformProvider: PlatformProvider,
  projectHarnessDir: (projectPath: string) => string
): WorkspaceProvider {
  return {
    id: "git-worktree",
    label: "Local Workspace",
    kind: "git-worktree",
    description: "Creates Git worktrees for code tasks or Harness-managed workspaces for non-Git tasks.",
    capabilities: {
      isolatedTaskWorkspace: true,
      gitWorktrees: true,
      harnessWorkspaces: true,
      branchPerTask: true,
      mergeIntoMainCheckout: true
    },
    async initializeProject(projectPath) {
      const inside = await platformProvider.run("git", ["rev-parse", "--is-inside-work-tree"], projectPath, true);
      let initialized = false;
      if (!inside.ok) {
        await platformProvider.run("git", ["init"], projectPath);
        initialized = true;
      }

      await ensureHarnessGitExclude(platformProvider, projectPath);

      const hasHead = await platformProvider.run("git", ["rev-parse", "--verify", "HEAD"], projectPath, true);
      if (hasHead.ok) {
        return {
          initialized,
          committed: false,
          head: hasHead.stdout.trim(),
          output: initialized ? "Initialized Git repository." : "Git repository already has a commit."
        };
      }

      await platformProvider.run("git", ["add", "-A"], projectPath);
      const commit = await platformProvider.run(
        "git",
        [
          "-c",
          "user.name=Harness Agent",
          "-c",
          "user.email=harness@local",
          "commit",
          "--allow-empty",
          "-m",
          "Initialize Harness project"
        ],
        projectPath
      );
      const head = await platformProvider.run("git", ["rev-parse", "HEAD"], projectPath);
      return {
        initialized,
        committed: true,
        head: head.stdout.trim(),
        output: commit.stdout || "Created initial Harness project commit."
      };
    },
    async ensureGitReady(projectPath) {
      const inside = await platformProvider.run("git", ["rev-parse", "--is-inside-work-tree"], projectPath, true);
      if (!inside.ok) {
        await platformProvider.run("git", ["init"], projectPath);
      }

      await ensureHarnessGitExclude(platformProvider, projectPath);

      const hasHead = await platformProvider.run("git", ["rev-parse", "--verify", "HEAD"], projectPath, true);
      if (!hasHead.ok) {
        throw new Error("Git worktree execution requires at least one commit in the project repository.");
      }
    },

    async ensureTaskWorkspace(projectPath, task) {
      if (task.worktreePath && task.workspaceMode === "harness" && !task.branchName) {
        return {
          kind: "harness",
          branchName: null,
          worktreePath: task.worktreePath
        };
      }

      if (task.worktreePath && task.workspaceMode === "worktree" && task.branchName) {
        return {
          kind: "git-worktree",
          branchName: task.branchName,
          worktreePath: task.worktreePath
        };
      }

      if (task.workspaceMode === "harness") {
        const worktreePath = path.join(projectHarnessDir(projectPath), "workspaces", task.id);
        mkdirSync(worktreePath, { recursive: true });
        return { kind: "harness", branchName: null, worktreePath };
      }

      await this.ensureGitReady(projectPath);

      const safeTitle = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
      const branchName = `harness/task-${task.id.slice(0, 8)}-${safeTitle || "work"}`;
      const worktreePath = path.join(projectHarnessDir(projectPath), "worktrees", task.id);
      mkdirSync(path.dirname(worktreePath), { recursive: true });

      const existingWorktree = await platformProvider.run("git", ["worktree", "list", "--porcelain"], projectPath);
      if (!existingWorktree.stdout.includes(worktreePath)) {
        await platformProvider.run("git", ["worktree", "add", "-B", branchName, worktreePath, "HEAD"], projectPath);
      }

      return { kind: "git-worktree", branchName, worktreePath };
    },

    async commitAll(cwd, message) {
      const status = await platformProvider.run("git", ["status", "--porcelain"], cwd);
      if (!status.stdout.trim()) {
        return { committed: false, output: "No file changes to commit.", error: null, commitSha: null, parentSha: null };
      }

      await platformProvider.run("git", ["add", "-A"], cwd);
      const commit = await platformProvider.run(
        "git",
        [
          "-c",
          "user.name=Harness Agent",
          "-c",
          "user.email=harness@local",
          "commit",
          "-m",
          message
        ],
        cwd
      );

      const commitSha = (await platformProvider.run("git", ["rev-parse", "HEAD"], cwd)).stdout.trim();
      const parent = await platformProvider.run("git", ["rev-parse", "HEAD^"], cwd, true);
      return {
        committed: true,
        output: commit.stdout || "Committed task changes.",
        error: null,
        commitSha: commitSha || null,
        parentSha: parent.ok ? parent.stdout.trim() || null : null
      };
    },

    mergeBranch(projectPath, branchName, message) {
      return platformProvider.run("git", ["merge", "--no-ff", branchName, "-m", message], projectPath, true);
    },

    async mergeState(projectPath, branchName) {
      const mergeHead = await platformProvider.run("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], projectPath, true);
      const branchMerged = await platformProvider.run("git", ["merge-base", "--is-ancestor", branchName, "HEAD"], projectPath, true);
      const unmerged = await platformProvider.run("git", ["diff", "--name-only", "--diff-filter=U"], projectPath, true);
      const status = await platformProvider.run("git", ["status", "--porcelain"], projectPath, true);
      return {
        inProgress: mergeHead.ok,
        branchMerged: branchMerged.ok,
        status: status.stdout,
        unmergedFiles: unmerged.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
      };
    },

    async finalizeMerge(projectPath) {
      await platformProvider.run("git", ["add", "-A"], projectPath);
      return platformProvider.run(
        "git",
        [
          "-c",
          "user.name=Harness Agent",
          "-c",
          "user.email=harness@local",
          "commit",
          "--no-edit"
        ],
        projectPath,
        true
      );
    },

    abortMerge(projectPath) {
      return platformProvider.run("git", ["merge", "--abort"], projectPath, true);
    },

    async workingTreeStatus(projectPath) {
      return (await platformProvider.run("git", ["status", "--porcelain"], projectPath)).stdout;
    },

    async localBranches(projectPath) {
      const current = await platformProvider.run("git", ["branch", "--show-current"], projectPath, true);
      const list = await platformProvider.run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], projectPath, true);
      return { current: current.stdout.trim(), branches: list.stdout.split("\n").map((value) => value.trim()).filter(Boolean) };
    },

    checkoutBranch(projectPath, branchName) {
      return platformProvider.run("git", ["checkout", branchName], projectPath, true);
    },

    removeWorktree(projectPath, worktreePath) {
      return platformProvider.run("git", ["worktree", "remove", worktreePath], projectPath, true);
    },

    async snapshotRef(cwd) {
      const inside = await platformProvider.run("git", ["rev-parse", "--is-inside-work-tree"], cwd, true);
      if (!inside.ok) {
        return `harness:${new Date().toISOString()}`;
      }
      return (await platformProvider.run("git", ["rev-parse", "HEAD"], cwd)).stdout.trim();
    },

    async changedFiles(cwd) {
      const inside = await platformProvider.run("git", ["rev-parse", "--is-inside-work-tree"], cwd, true);
      if (!inside.ok) {
        return [];
      }
      const status = await platformProvider.run("git", ["status", "--porcelain"], cwd);
      return status.stdout
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const file = line.slice(3).trim();
          return file.includes(" -> ") ? file.split(" -> ").pop()?.trim() || file : file;
        });
    }
  };
}

function createLocalHumanApprovalProvider(): ApprovalProvider {
  return {
    id: "local-human",
    definition: {
      id: "local-human",
      label: "Local Human Approval",
      kind: "local-human",
      description: "Stores approval requests locally and resumes approved tasks from the Harness runtime.",
      capabilities: {
        commandExecution: true,
        mergeApproval: true,
        handoffApproval: true,
        remembersDecisions: true,
        resumesApprovedTasks: true
      }
    },

    evaluateCommandExecution(input) {
      if (!input.required || !input.llmProvider.requiresCommand) {
        return { action: "allow" };
      }

      const approved = input.existingApprovals.find(
        (approval) => approval.status === "approved" && approval.commandPreview === input.commandPreview
      );
      if (approved) {
        return { action: "allow" };
      }

      const rejected = input.existingApprovals.find(
        (approval) => approval.status === "rejected" && approval.commandPreview === input.commandPreview
      );
      if (rejected) {
        return { action: "block", reason: this.rejectionReason(rejected) };
      }

      const reason = input.riskReason
        ? `${input.agent.name} needs approval before running ${input.llmProvider.label}. ${input.riskReason}`
        : `${input.agent.name} needs approval before running ${input.llmProvider.label}.`;
      const pending = input.existingApprovals.find(
        (approval) => approval.status === "pending" && approval.commandPreview === input.commandPreview
      );
      if (pending) {
        return { action: "block", reason };
      }

      return {
        action: "request",
        reason,
        commandPreview: input.commandPreview,
        metadata: {
          provider: input.llmProvider.id,
          approvalProvider: this.id,
          effectiveBackend: input.effectiveBackend,
          commandPreview: input.commandPreview,
          riskTags: input.riskTags.join(",") || null,
          riskReason: input.riskReason
        }
      };
    },

    evaluateMerge(input) {
      const approved = input.existingApprovals.find((approval) => approval.status === "approved");
      if (approved) {
        return { action: "allow" };
      }

      const rejected = input.existingApprovals.find((approval) => approval.status === "rejected");
      if (rejected) {
        return { action: "block", reason: this.rejectionReason(rejected) };
      }

      const reason = `${input.agent.name}'s task changes need approval before merging.`;
      const pending = input.existingApprovals.find((approval) => approval.status === "pending");
      if (pending) {
        return { action: "block", reason };
      }

      return {
        action: "request",
        reason,
        metadata: {
          approvalProvider: this.id,
          branchName: input.task.branchName,
          worktreePath: input.task.worktreePath
        }
      };
    },

    decisionMessage(decision, approval) {
      if (approval.kind === "merge") {
        return decision === "approved"
          ? "Human approved merging this task into the main checkout."
          : "Human requested changes before merging this task.";
      }
      if (approval.kind === "handoff") {
        return decision === "approved"
          ? "Human approved the PM handoff decision."
          : "Human rejected the PM handoff decision.";
      }

      return decision === "approved"
        ? "Human approved command execution for this task."
        : "Human rejected command execution for this task.";
    },

    rejectionReason(approval) {
      if (approval.kind === "merge") {
        return "Human requested changes before merging this task.";
      }
      if (approval.kind === "handoff") {
        return "Human rejected the PM handoff decision.";
      }
      return "Command execution approval was rejected.";
    }
  };
}

function killShellProcess(pid: number | undefined, signal: NodeJS.Signals, useProcessGroup: boolean) {
  if (!pid) {
    return;
  }

  try {
    process.kill(useProcessGroup ? -pid : pid, signal);
  } catch {
    // The command may have already exited between timeout checks.
  }
}

function createMockLlmProvider(): LlmProvider {
  return {
    id: "mock",
    definition: {
      id: "mock",
      label: "Mock",
      kind: "mock",
      description: "Deterministic local provider for testing Harness without calling an LLM.",
      requiresCommand: false,
      commandExample: null,
      capabilities: { ...nonStreamingCapabilities, structuredDecision: true }
    },
    async run(agent, task, workspace, context) {
      const korean = context?.responseLocale !== "en";
      const interactionKind = !context?.resume && !context?.taskRuns?.some((run) => run.status === "suspended") &&
        (["question", "approval", "permission", "review"] as const).find((kind) =>
          task.labels.includes(`mock-interaction-${kind}`)
        );
      const output = korean ? [
        `에이전트: ${agent.name}`,
        `역할: ${agent.role}`,
        `일감: ${task.title}`,
        `연결된 파일: ${task.linkedFiles.length}개`,
        `일감 댓글: ${context?.taskComments?.length || 0}개`,
        `이전 실행: ${context?.taskRuns?.length || 0}개`,
        `전역 메모리: ${context?.globalMemory.length || 0}개`,
        `프로젝트 메모리: ${context?.projectMemory.length || 0}개`,
        ...(context?.resume ? [
          `재개한 상호작용: ${context.resume.interactionId}`,
          `사용자 응답: ${JSON.stringify(context.resume.responsePayload)}`
        ] : []),
        "",
        "모의 어댑터가 일감을 완료했습니다. 실제 LLM CLI를 실행하려면 에이전트에 셸 CLI 명령을 설정하세요."
      ].join("\n") : [
        `Agent: ${agent.name}`,
        `Role: ${agent.role}`,
        `Task: ${task.title}`,
        `Linked files: ${task.linkedFiles.length}`,
        `Task comments: ${context?.taskComments?.length || 0}`,
        `Previous task runs: ${context?.taskRuns?.length || 0}`,
        `Global memory entries: ${context?.globalMemory.length || 0}`,
        `Project memory entries: ${context?.projectMemory.length || 0}`,
        ...(context?.resume ? [
          `Resumed interaction: ${context.resume.interactionId}`,
          `Human response: ${JSON.stringify(context.resume.responsePayload)}`
        ] : []),
        "",
        "Mock adapter completed this task. Configure a shell CLI command on the agent to execute a real LLM CLI."
      ].join("\n");
      const files = writePromptFiles("mock", agent, task, workspace, context);
      if (interactionKind) {
        return {
          status: "suspended",
          ok: true,
          output: `Mock provider is waiting for a ${interactionKind} interaction.`,
          error: null,
          interaction: {
            kind: interactionKind,
            requestPayload: {
              prompt: task.description || `Respond to the mock ${interactionKind} request.`,
              source: "mock-provider"
            },
            checkpoint: { providerId: "mock", promptFile: files.promptFile, phase: "waiting-for-interaction" }
          }
        };
      }
      writeFileSync(
        path.join(workspace.worktreePath, "HARNESS_AGENT_RESULT.md"),
        `# Harness Agent Result\n\n${output}\n\nPrompt: ${files.promptFile}\n`,
        "utf8"
      );
      return {
        status: "completed",
        ok: true,
        output,
        error: null,
        completion: {
          summary: korean ? `모의 공급자가 '${task.title}' 일감을 완료했습니다.` : `Mock provider completed ${task.title}.`,
          acceptanceCriteria: task.acceptanceCriteria.split(/\n|;/).map((criterion) => criterion.trim()).filter(Boolean).map((criterion) => ({
            criterion,
            met: true,
            evidence: "Deterministic mock execution completed."
          })),
          decisions: ["Used the deterministic mock provider."],
          validations: [
            { kind: "test", ran: false, passed: false, evidence: "No test command was configured for the mock provider." },
            { kind: "typecheck", ran: false, passed: false, evidence: "No typecheck command was configured for the mock provider." },
            { kind: "lint", ran: false, passed: false, evidence: "No lint command was configured for the mock provider." },
            { kind: "build", ran: false, passed: false, evidence: "No build command was configured for the mock provider." }
          ],
          limitations: ["Mock execution does not verify project-specific behavior."],
          followUps: []
        }
      };
    }
  };
}

function createShellLlmProvider(platformProvider: PlatformProvider): LlmProvider {
  return {
    id: "shell",
    definition: {
      id: "shell",
      label: "Generic Shell",
      kind: "generic-shell",
      description: "Runs a custom shell command with Harness task context in environment variables.",
      requiresCommand: true,
      commandExample: "node ./scripts/agent-runner.js",
      capabilities: nonStreamingCapabilities
    },
    async run(agent, task, workspace, context) {
      if (!agent.cliCommand) {
        return { status: "failed", ok: false, output: "", error: "Shell provider requires an agent CLI command." };
      }

      const result = await platformProvider.runShell(
        agent.cliCommand,
        workspace.worktreePath,
        buildLlmEnvironment("shell", agent, task, workspace, context),
        context?.timeoutMs
      );
      return { ...result, status: result.ok ? "completed" : "failed" };
    }
  };
}

const cursorDefaultCommand = 'cursor-agent -p --force --output-format stream-json < "$HARNESS_PROMPT_FILE"';

function createCursorCliProvider(platformProvider: PlatformProvider): LlmProvider {
  return {
    id: "cursor-cli",
    definition: {
      id: "cursor-cli",
      label: "Cursor CLI",
      kind: "llm-cli",
      description: "Runs Cursor Agent in headless stream-JSON mode using its existing login session. Override the command to add --model or --resume.",
      requiresCommand: true,
      commandExample: cursorDefaultCommand,
      defaultCommand: cursorDefaultCommand,
      capabilities: {
        streaming: true,
        sessionResume: true,
        toolEvents: true,
        diffEvents: false,
        usageEvents: false,
        structuredDecision: false,
        gracefulStop: false
      },
      authentication: {
        strategy: "cli-session",
        executable: "cursor-agent",
        versionArgs: ["--version"],
        statusArgs: ["status"],
        loginCommand: "cursor-agent login"
      }
    },
    async run(agent, task, workspace, context) {
      if (!agent.cliCommand) {
        return { status: "failed", ok: false, output: "", error: "Cursor CLI command is unavailable." };
      }
      let assistantOutput = "";
      let terminalSummary = "";
      let terminalSeen = false;
      let terminalError = false;
      let eventError: string | null = null;
      const cursorCommand = context?.resumeSession
        ? `cursor-agent --resume ${shellQuote(context.resumeSession.sessionId)} -p --force --output-format stream-json < \"$HARNESS_PROMPT_FILE\"`
        : agent.cliCommand;
      const invoke = (command: string) => platformProvider.runShellLines(
        command, workspace.worktreePath, buildLlmEnvironment("cursor-cli", agent, task, workspace, context), context?.timeoutMs, (line) => {
          const event = parseCursorStreamLine(line);
          if (!event) return;
          if (event.type === "text_delta" && typeof event.payload.text === "string") assistantOutput += event.payload.text;
          if (event.type === "result" || event.type === "error") {
            terminalSeen = true;
            terminalError = event.type === "error";
            if (typeof event.payload.summary === "string") terminalSummary = event.payload.summary;
          }
          try {
            context?.onEvent?.(event);
          } catch (error) {
            eventError = error instanceof Error ? error.message : String(error);
          }
        });
      let processResult = await invoke(cursorCommand);
      let ok = processResult.ok && terminalSeen && !terminalError && !eventError;
      if (!ok && context?.resumeSession) {
        assistantOutput = ""; terminalSummary = ""; terminalSeen = false; terminalError = false; eventError = null;
        context.onEvent?.({ type: "decision", payload: { phase: "session_fallback", sessionId: context.resumeSession.sessionId } });
        processResult = await invoke(agent.cliCommand);
        ok = processResult.ok && terminalSeen && !terminalError && !eventError;
      }
      return {
        status: ok ? "completed" : "failed",
        ok,
        output: terminalSummary || assistantOutput,
        error: ok ? null : eventError || processResult.error || terminalSummary || "Cursor CLI stream ended without a successful result."
      };
    }
  };
}

function createCliLlmProvider(
  platformProvider: PlatformProvider,
  input: Omit<LlmProviderDefinition, "kind" | "requiresCommand" | "capabilities">
): LlmProvider {
  return {
    id: input.id,
    definition: {
      ...input,
      kind: "llm-cli",
      requiresCommand: true,
      capabilities: nonStreamingCapabilities
    },
    async run(agent, task, workspace, context) {
      if (!agent.cliCommand) {
        return {
          status: "failed",
          ok: false,
          output: "",
          error: `${input.label} provider requires a CLI command. Example: ${input.commandExample}`
        };
      }

      const result = await platformProvider.runShell(
        agent.cliCommand,
        workspace.worktreePath,
        buildLlmEnvironment(input.id, agent, task, workspace, context),
        context?.timeoutMs
      );
      return { ...result, status: result.ok ? "completed" : "failed" };
    }
  };
}

function buildLlmEnvironment(
  providerId: string,
  agent: AgentRecord,
  task: TaskRecord,
  workspace: TaskWorkspace,
  context?: LlmRunContext
) {
  const files = writePromptFiles(providerId, agent, task, workspace, context);
  return {
    HARNESS_LLM_PROVIDER: providerId,
    HARNESS_RESPONSE_LOCALE: context?.responseLocale === "en" ? "en" : "ko",
    HARNESS_PROMPT_FILE: files.promptFile,
    HARNESS_AGENT_DEFINITION_FILE: files.agentDefinitionFile,
    HARNESS_GLOBAL_MEMORY: files.globalMemoryText,
    HARNESS_GLOBAL_MEMORY_FILE: files.globalMemoryFile,
    HARNESS_PROJECT_MEMORY: files.projectMemoryText,
    HARNESS_PROJECT_MEMORY_FILE: files.projectMemoryFile,
    HARNESS_TASK_COMMENTS: files.taskCommentsText,
    HARNESS_TASK_RUN_SUMMARY: files.taskRunSummaryText,
    HARNESS_RESUME_CONTEXT: context?.resume ? JSON.stringify(context.resume) : "",
    HARNESS_AGENT_NAME: agent.name,
    HARNESS_AGENT_ROLE: agent.role,
    HARNESS_AGENT_PERSONA: agent.persona,
    HARNESS_AGENT_ALLOWED_TOOLS: agent.allowedTools.join(","),
    HARNESS_AGENT_BOUNDARIES: agent.boundaries,
    HARNESS_TASK_ID: task.id,
    HARNESS_TASK_TITLE: task.title,
    HARNESS_TASK_DESCRIPTION: task.description,
    HARNESS_ACCEPTANCE_CRITERIA: task.acceptanceCriteria,
    HARNESS_LINKED_FILES: task.linkedFiles.join(","),
    HARNESS_BRANCH_NAME: workspace.branchName || "",
    HARNESS_WORKSPACE_KIND: workspace.kind,
    HARNESS_WORKSPACE_MODE: task.workspaceMode,
    HARNESS_WORKSPACE_PATH: workspace.worktreePath,
    HARNESS_WORKTREE_PATH: workspace.worktreePath,
    HARNESS_ALLOWED_WORKSPACE_PATH: context?.workspaceProtection?.canonicalWorkspacePath || workspace.worktreePath,
    HARNESS_PUSH_EXCEPTION_TOKEN: context?.workspaceProtection?.pushExceptionToken || ""
  };
}

function writePromptFiles(
  providerId: string,
  agent: AgentRecord,
  task: TaskRecord,
  workspace: TaskWorkspace,
  context?: LlmRunContext
) {
  const promptDir = path.join(workspace.worktreePath, ".harness");
  mkdirSync(promptDir, { recursive: true });
  const promptFile = path.join(promptDir, "agent-prompt.md");
  const agentDefinitionFile = path.join(promptDir, "agent-definition.md");
  const globalMemoryFile = path.join(promptDir, "global-memory.md");
  const projectMemoryFile = path.join(promptDir, "project-memory.md");
  const globalMemoryText = formatMemory(context?.globalMemory || []);
  const projectMemoryText = formatMemory(context?.projectMemory || []);
  const taskCommentsText = formatTaskComments(context?.taskComments || []);
  const taskRunSummaryText = formatTaskRuns(context?.taskRuns || []);
  const responseLocale = context?.responseLocale === "en" ? "en" : "ko";
  const responseLanguage = responseLocale === "ko" ? "Korean (한국어)" : "English";
  const workspaceInstruction =
    workspace.kind === "git-worktree"
      ? "Work only inside this task Git worktree. Report changed files, verification performed, and any blockers."
      : "Work only inside this Harness-managed workspace. Do not assume a Git branch or merge step exists. Report produced artifacts, verification performed, and any blockers.";
  writeFileSync(globalMemoryFile, globalMemoryText, "utf8");
  writeFileSync(projectMemoryFile, projectMemoryText, "utf8");
  writeFileSync(agentDefinitionFile, context?.agentDefinitionSnapshot || "", "utf8");
  const prompt = [
    `# Harness Agent Task`,
    ``,
    `Provider: ${providerId}`,
    `Agent: ${agent.name}`,
    `Role: ${agent.role}`,
    ``,
    `## Persona`,
    agent.persona,
    ``,
    `## Agent Definition Snapshot`,
    context?.agentDefinitionSnapshot || "(not available)",
    ``,
    `## Allowed Tools`,
    formatList(agent.allowedTools),
    ``,
    `## Boundaries`,
    agent.boundaries || "(none)",
    ``,
    `## Task`,
    task.title,
    ``,
    `## Description`,
    task.description || "(none)",
    ``,
    `## Acceptance Criteria`,
    task.acceptanceCriteria || "(none)",
    ``,
    `## Linked Files`,
    formatList(task.linkedFiles),
    ``,
    `## Task Comments`,
    taskCommentsText,
    ``,
    `## Global Memory`,
    globalMemoryText,
    ``,
    `## Project Memory`,
    projectMemoryText,
    ``,
    `## Recent Task Runs`,
    taskRunSummaryText,
    ``,
    ...(context?.resume ? [
      `## Resume Context`,
      `Interaction: ${context.resume.interactionId}`,
      `Parent run: ${context.resume.parentRunId}`,
      `Correlation: ${context.resume.correlationId}`,
      `Human response: ${JSON.stringify(context.resume.responsePayload)}`,
      `Checkpoint: ${JSON.stringify(context.resume.checkpoint || {})}`,
      ``
    ] : []),
    `## Workspace`,
    `Kind: ${workspace.kind}`,
    `Mode: ${task.workspaceMode}`,
    `Branch: ${workspace.branchName || "none"}`,
    `Path: ${workspace.worktreePath}`,
    ``,
    workspaceInstruction,
    ``,
    `## Completion Summary`,
    `When the work ends, write the final response as a concise summary in ${responseLanguage}.`,
    `Include completed work, changed files or artifacts, verification performed, and remaining issues or blockers.`,
    `Always provide this summary, including when no files changed.`
  ].join("\n");
  writeFileSync(promptFile, prompt, "utf8");
  return {
    promptFile,
    agentDefinitionFile,
    globalMemoryFile,
    projectMemoryFile,
    globalMemoryText,
    projectMemoryText,
    taskCommentsText,
    taskRunSummaryText
  };
}

function formatList(items: string[]) {
  if (!items.length) {
    return "(none)";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function formatMemory(memories: MemoryRecord[]) {
  if (memories.length === 0) {
    return "(none)";
  }

  return memories
    .map((memory) => [`### ${memory.title}`, memory.content || "(empty)"].join("\n"))
    .join("\n\n");
}

function formatTaskComments(comments: CommentRecord[]) {
  if (comments.length === 0) {
    return "(none)";
  }

  return comments
    .slice(0, 10)
    .map((comment) => [`### ${comment.author} at ${comment.createdAt}`, comment.body || "(empty)"].join("\n"))
    .join("\n\n");
}

function formatTaskRuns(runs: RunRecord[]) {
  if (runs.length === 0) {
    return "(none)";
  }

  return runs
    .slice(0, 5)
    .map((run) => {
      const output = [run.output, run.error].filter(Boolean).join("\n").trim();
      const excerpt = output ? truncate(output, 1200) : "(no output)";
      return [
        `### Run ${run.id.slice(0, 8)} (${run.status})`,
        `Agent: ${run.agentId.slice(0, 8)}`,
        `Provider: ${run.providerId || "unknown"}`,
        `Model backend: ${run.modelBackend || "unknown"}`,
        `Started: ${run.startedAt}`,
        `Completed: ${run.completedAt || "not completed"}`,
        `Changed files: ${run.changedFiles.length ? run.changedFiles.join(", ") : "none"}`,
        ``,
        excerpt
      ].join("\n");
    })
    .join("\n\n");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 15)}\n...[truncated]`;
}

async function ensureHarnessGitExclude(platformProvider: PlatformProvider, projectPath: string) {
  const excludePath = await platformProvider.run("git", ["rev-parse", "--git-path", "info/exclude"], projectPath);
  const filePath = path.isAbsolute(excludePath.stdout.trim())
    ? excludePath.stdout.trim()
    : path.join(projectPath, excludePath.stdout.trim());
  const current = readFileSync(filePath, "utf8");
  if (!current.split(/\r?\n/).some((line) => line.trim() === ".harness/")) {
    appendFileSync(filePath, `${current.endsWith("\n") ? "" : "\n"}.harness/\n`, "utf8");
  }
}

async function run(command: string, args: string[], cwd: string, allowFailure = false): Promise<CommandResult> {
  const result = await new Promise<Omit<CommandResult, "ok">>((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  const ok = result.code === 0;
  if (!ok && !allowFailure) {
    throw new Error(result.stderr || `${command} ${args.join(" ")} failed`);
  }

  return { ...result, ok };
}
