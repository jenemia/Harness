import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentRecord, ApprovalRecord, MemoryRecord, TaskRecord } from "./types.js";

export type CommandResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type TaskWorkspace = {
  branchName: string;
  worktreePath: string;
};

export type LlmRunContext = {
  projectMemory: MemoryRecord[];
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
    branchPerTask: boolean;
    mergeIntoMainCheckout: boolean;
  };
  ensureGitReady(projectPath: string): Promise<void>;
  ensureTaskWorkspace(projectPath: string, task: TaskRecord): Promise<TaskWorkspace>;
  commitAll(cwd: string, message: string): Promise<{ committed: boolean; output: string; error: string | null }>;
  mergeBranch(projectPath: string, branchName: string, message: string): Promise<CommandResult>;
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
    remembersDecisions: boolean;
    resumesApprovedTasks: boolean;
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

export type ApprovalProvider = {
  id: string;
  definition: ApprovalProviderDefinition;
  evaluateCommandExecution(input: {
    required: boolean;
    task: TaskRecord;
    agent: AgentRecord;
    llmProvider: LlmProviderDefinition;
    effectiveBackend: string;
    commandPreview: string | null;
    existingApprovals: ApprovalRecord[];
  }): CommandApprovalEvaluation;
  decisionMessage(decision: "approved" | "rejected", approval: ApprovalRecord): string;
  rejectionReason(approval: ApprovalRecord): string;
};

export class ProviderRegistry {
  constructor(
    private readonly platformProvider: PlatformProvider,
    private readonly workspaceProvider: WorkspaceProvider,
    private readonly approvalProvider: ApprovalProvider,
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
  return new ProviderRegistry(platformProvider, workspaceProvider, approvalProvider, [
    createMockLlmProvider(),
    createShellLlmProvider(platformProvider),
    createCliLlmProvider(platformProvider, {
      id: "codex",
      label: "Codex CLI",
      description: "Runs a user-configured Codex CLI command inside the task worktree.",
      commandExample: "codex exec \"$HARNESS_PROMPT_FILE\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "claude",
      label: "Claude Code CLI",
      description: "Runs a user-configured Claude Code CLI command inside the task worktree.",
      commandExample: "claude -p \"$(cat $HARNESS_PROMPT_FILE)\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "gemini",
      label: "Gemini CLI",
      description: "Runs a user-configured Gemini CLI command inside the task worktree.",
      commandExample: "gemini -p \"$(cat $HARNESS_PROMPT_FILE)\""
    }),
    createCliLlmProvider(platformProvider, {
      id: "ollama",
      label: "Ollama",
      description: "Runs a user-configured Ollama command inside the task worktree.",
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
    label: "Git Worktree Workspace",
    kind: "git-worktree",
    description: "Creates one Git branch and worktree per executable task.",
    capabilities: {
      isolatedTaskWorkspace: true,
      gitWorktrees: true,
      branchPerTask: true,
      mergeIntoMainCheckout: true
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
      if (task.worktreePath && task.branchName) {
        return {
          branchName: task.branchName,
          worktreePath: task.worktreePath
        };
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

      return { branchName, worktreePath };
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

    async workingTreeStatus(projectPath) {
      return (await platformProvider.run("git", ["status", "--porcelain"], projectPath)).stdout;
    },

    async snapshotRef(cwd) {
      return (await platformProvider.run("git", ["rev-parse", "HEAD"], cwd)).stdout.trim();
    },

    async changedFiles(cwd) {
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

      const reason = `${input.agent.name} needs approval before running ${input.llmProvider.label}.`;
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
          commandPreview: input.commandPreview
        }
      };
    },

    decisionMessage(decision) {
      return decision === "approved"
        ? "Human approved command execution for this task."
        : "Human rejected command execution for this task.";
    },

    rejectionReason() {
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
    HARNESS_PROJECT_MEMORY: files.memoryText,
    HARNESS_PROJECT_MEMORY_FILE: files.memoryFile,
    HARNESS_AGENT_NAME: agent.name,
    HARNESS_AGENT_ROLE: agent.role,
    HARNESS_AGENT_PERSONA: agent.persona,
    HARNESS_TASK_ID: task.id,
    HARNESS_TASK_TITLE: task.title,
    HARNESS_TASK_DESCRIPTION: task.description,
    HARNESS_ACCEPTANCE_CRITERIA: task.acceptanceCriteria,
    HARNESS_BRANCH_NAME: workspace.branchName,
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
  const memoryFile = path.join(promptDir, "project-memory.md");
  const memoryText = formatProjectMemory(context?.projectMemory || []);
  writeFileSync(memoryFile, memoryText, "utf8");
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
    `## Task`,
    task.title,
    ``,
    `## Description`,
    task.description || "(none)",
    ``,
    `## Acceptance Criteria`,
    task.acceptanceCriteria || "(none)",
    ``,
    `## Project Memory`,
    memoryText,
    ``,
    `## Workspace`,
    `Branch: ${workspace.branchName}`,
    `Path: ${workspace.worktreePath}`,
    ``,
    `Work only inside this task worktree. Report changed files, verification performed, and any blockers.`
  ].join("\n");
  writeFileSync(promptFile, prompt, "utf8");
  return { promptFile, memoryFile, memoryText };
}

function formatProjectMemory(memories: MemoryRecord[]) {
  if (memories.length === 0) {
    return "(none)";
  }

  return memories
    .map((memory) => [`### ${memory.title}`, memory.content || "(empty)"].join("\n"))
    .join("\n\n");
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
