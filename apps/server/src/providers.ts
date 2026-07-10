import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentRecord, ApprovalRecord, MemoryRecord, RunRecord, TaskRecord } from "./types.js";

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
  globalMemory: MemoryRecord[];
  projectMemory: MemoryRecord[];
  taskRuns?: RunRecord[];
  timeoutMs?: number;
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
  commitAll(cwd: string, message: string): Promise<{ committed: boolean; output: string; error: string | null }>;
  mergeBranch(projectPath: string, branchName: string, message: string): Promise<CommandResult>;
  mergeState(projectPath: string, branchName: string): Promise<MergeState>;
  finalizeMerge(projectPath: string): Promise<CommandResult>;
  abortMerge(projectPath: string): Promise<CommandResult>;
  workingTreeStatus(projectPath: string): Promise<string>;
  snapshotRef(cwd: string): Promise<string>;
  changedFiles(cwd: string): Promise<string[]>;
};

export type LlmProvider = {
  id: string;
  definition: LlmProviderDefinition;
  run(
    agent: AgentRecord,
    task: TaskRecord,
    workspace: TaskWorkspace,
    context?: LlmRunContext
  ): Promise<{ ok: boolean; output: string; error: string | null }>;
};

export type LlmProviderDefinition = {
  id: string;
  label: string;
  kind: "mock" | "generic-shell" | "llm-cli";
  description: string;
  requiresCommand: boolean;
  commandExample: string | null;
};

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

export function createDefaultProviders(projectHarnessDir: (projectPath: string) => string) {
  const platformProvider = createPlatformProvider();
  const workspaceProvider = createGitWorktreeWorkspaceProvider(platformProvider, projectHarnessDir);
  const approvalProvider = createLocalHumanApprovalProvider();
  const policyProvider = createLocalAgentPolicyProvider();
  return new ProviderRegistry(platformProvider, workspaceProvider, approvalProvider, policyProvider, [
    createMockLlmProvider(),
    createShellLlmProvider(platformProvider),
    createCliLlmProvider(platformProvider, {
      id: "codex",
      label: "Codex CLI",
      description: "Runs a user-configured Codex CLI command inside the task workspace.",
      commandExample: "codex exec \"$HARNESS_PROMPT_FILE\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "claude",
      label: "Claude Code CLI",
      description: "Runs a user-configured Claude Code CLI command inside the task workspace.",
      commandExample: "claude -p \"$(cat $HARNESS_PROMPT_FILE)\""
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
      description: "Runs a user-configured Ollama command inside the task workspace.",
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
        riskyCommandApproval: true
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

function detectRiskyCommand(command: string) {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  const patterns: Array<{ tag: string; label: string; regex: RegExp }> = [
    { tag: "destructive-delete", label: "recursive forced delete", regex: /\brm\s+-[^\n;|&]*r[^\n;|&]*f|\brm\s+-[^\n;|&]*f[^\n;|&]*r/i },
    { tag: "git-reset-hard", label: "hard Git reset", regex: /\bgit\s+reset\s+--hard\b/i },
    { tag: "git-clean", label: "Git clean", regex: /\bgit\s+clean\s+-[^\n;|&]*[fdx]/i },
    { tag: "git-push", label: "Git push", regex: /\bgit\s+push\b/i },
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
        return { committed: false, output: "No file changes to commit.", error: null };
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

      return { committed: true, output: commit.stdout || "Committed task changes.", error: null };
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
      commandExample: null
    },
    async run(agent, task, workspace, context) {
      const output = [
        `Agent: ${agent.name}`,
        `Role: ${agent.role}`,
        `Task: ${task.title}`,
        `Linked files: ${task.linkedFiles.length}`,
        `Previous task runs: ${context?.taskRuns?.length || 0}`,
        `Global memory entries: ${context?.globalMemory.length || 0}`,
        `Project memory entries: ${context?.projectMemory.length || 0}`,
        "",
        "Mock adapter completed this task. Configure a shell CLI command on the agent to execute a real LLM CLI."
      ].join("\n");
      const files = writePromptFiles("mock", agent, task, workspace, context);
      writeFileSync(
        path.join(workspace.worktreePath, "HARNESS_AGENT_RESULT.md"),
        `# Harness Agent Result\n\n${output}\n\nPrompt: ${files.promptFile}\n`,
        "utf8"
      );
      return { ok: true, output, error: null };
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
      commandExample: "node ./scripts/agent-runner.js"
    },
    async run(agent, task, workspace, context) {
      if (!agent.cliCommand) {
        return { ok: false, output: "", error: "Shell provider requires an agent CLI command." };
      }

      return platformProvider.runShell(
        agent.cliCommand,
        workspace.worktreePath,
        buildLlmEnvironment("shell", agent, task, workspace, context),
        context?.timeoutMs
      );
    }
  };
}

function createCliLlmProvider(
  platformProvider: PlatformProvider,
  input: Omit<LlmProviderDefinition, "kind" | "requiresCommand">
): LlmProvider {
  return {
    id: input.id,
    definition: {
      ...input,
      kind: "llm-cli",
      requiresCommand: true
    },
    async run(agent, task, workspace, context) {
      if (!agent.cliCommand) {
        return {
          ok: false,
          output: "",
          error: `${input.label} provider requires a CLI command. Example: ${input.commandExample}`
        };
      }

      return platformProvider.runShell(
        agent.cliCommand,
        workspace.worktreePath,
        buildLlmEnvironment(input.id, agent, task, workspace, context),
        context?.timeoutMs
      );
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
    HARNESS_PROMPT_FILE: files.promptFile,
    HARNESS_GLOBAL_MEMORY: files.globalMemoryText,
    HARNESS_GLOBAL_MEMORY_FILE: files.globalMemoryFile,
    HARNESS_PROJECT_MEMORY: files.projectMemoryText,
    HARNESS_PROJECT_MEMORY_FILE: files.projectMemoryFile,
    HARNESS_TASK_RUN_SUMMARY: files.taskRunSummaryText,
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
    HARNESS_WORKTREE_PATH: workspace.worktreePath
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
  const globalMemoryFile = path.join(promptDir, "global-memory.md");
  const projectMemoryFile = path.join(promptDir, "project-memory.md");
  const globalMemoryText = formatMemory(context?.globalMemory || []);
  const projectMemoryText = formatMemory(context?.projectMemory || []);
  const taskRunSummaryText = formatTaskRuns(context?.taskRuns || []);
  const workspaceInstruction =
    workspace.kind === "git-worktree"
      ? "Work only inside this task Git worktree. Report changed files, verification performed, and any blockers."
      : "Work only inside this Harness-managed workspace. Do not assume a Git branch or merge step exists. Report produced artifacts, verification performed, and any blockers.";
  writeFileSync(globalMemoryFile, globalMemoryText, "utf8");
  writeFileSync(projectMemoryFile, projectMemoryText, "utf8");
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
    `## Global Memory`,
    globalMemoryText,
    ``,
    `## Project Memory`,
    projectMemoryText,
    ``,
    `## Recent Task Runs`,
    taskRunSummaryText,
    ``,
    `## Workspace`,
    `Kind: ${workspace.kind}`,
    `Mode: ${task.workspaceMode}`,
    `Branch: ${workspace.branchName || "none"}`,
    `Path: ${workspace.worktreePath}`,
    ``,
    workspaceInstruction
  ].join("\n");
  writeFileSync(promptFile, prompt, "utf8");
  return { promptFile, globalMemoryFile, projectMemoryFile, globalMemoryText, projectMemoryText, taskRunSummaryText };
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
