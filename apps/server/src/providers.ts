import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentRecord, MemoryRecord, TaskRecord } from "./types.js";

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
};

export type PlatformProvider = {
  id: string;
  platform: NodeJS.Platform;
  run(command: string, args: string[], cwd: string, allowFailure?: boolean): Promise<CommandResult>;
  runShell(command: string, cwd: string, extraEnv: Record<string, string>): Promise<{ ok: boolean; output: string; error: string | null }>;
  ensureGitReady(projectPath: string): Promise<void>;
  ensureTaskWorktree(projectPath: string, task: TaskRecord): Promise<TaskWorkspace>;
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

export class ProviderRegistry {
  constructor(
    private readonly platformProvider: PlatformProvider,
    private readonly llmProviders: LlmProvider[]
  ) {}

  platform() {
    return this.platformProvider;
  }

  llm(modelBackend: string) {
    return this.llmProviders.find((provider) => provider.id === modelBackend) ?? this.llmProviders[0];
  }

  llmDefinitions() {
    return this.llmProviders.map((provider) => provider.definition);
  }
}

export function createDefaultProviders(projectHarnessDir: (projectPath: string) => string) {
  const platformProvider = createNodePlatformProvider(projectHarnessDir);
  return new ProviderRegistry(platformProvider, [
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

function createNodePlatformProvider(projectHarnessDir: (projectPath: string) => string): PlatformProvider {
  return {
    id: `node-${process.platform}`,
    platform: process.platform,

    run,

    async runShell(command, cwd, extraEnv) {
      const result = await new Promise<{ code: number | null; output: string; error: string }>((resolve) => {
        const child = spawn(command, {
          cwd,
          shell: true,
          env: { ...process.env, ...extraEnv }
        });
        let output = "";
        let error = "";

        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          error += chunk.toString();
        });
        child.on("close", (code) => resolve({ code, output, error }));
      });

      return {
        ok: result.code === 0,
        output: result.output,
        error: result.error || (result.code === 0 ? null : `Command exited with code ${result.code}`)
      };
    },

    async ensureGitReady(projectPath) {
      const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], projectPath, true);
      if (!inside.ok) {
        await run("git", ["init"], projectPath);
      }

      await ensureHarnessGitExclude(projectPath);

      const hasHead = await run("git", ["rev-parse", "--verify", "HEAD"], projectPath, true);
      if (!hasHead.ok) {
        throw new Error("Git worktree execution requires at least one commit in the project repository.");
      }
    },

    async ensureTaskWorktree(projectPath, task) {
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

      const existingWorktree = await run("git", ["worktree", "list", "--porcelain"], projectPath);
      if (!existingWorktree.stdout.includes(worktreePath)) {
        await run("git", ["worktree", "add", "-B", branchName, worktreePath, "HEAD"], projectPath);
      }

      return { branchName, worktreePath };
    },

    async commitAll(cwd, message) {
      const status = await run("git", ["status", "--porcelain"], cwd);
      if (!status.stdout.trim()) {
        return { committed: false, output: "No file changes to commit.", error: null };
      }

      await run("git", ["add", "-A"], cwd);
      const commit = await run(
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
      return run("git", ["merge", "--no-ff", branchName, "-m", message], projectPath, true);
    },

    async workingTreeStatus(projectPath) {
      return (await run("git", ["status", "--porcelain"], projectPath)).stdout;
    },

    async snapshotRef(cwd) {
      return (await run("git", ["rev-parse", "HEAD"], cwd)).stdout.trim();
    },

    async changedFiles(cwd) {
      const status = await run("git", ["status", "--porcelain"], cwd);
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

      return platformProvider.runShell(agent.cliCommand, workspace.worktreePath, buildLlmEnvironment("shell", agent, task, workspace, context));
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

      return platformProvider.runShell(agent.cliCommand, workspace.worktreePath, buildLlmEnvironment(input.id, agent, task, workspace, context));
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

async function ensureHarnessGitExclude(projectPath: string) {
  const excludePath = await run("git", ["rev-parse", "--git-path", "info/exclude"], projectPath);
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
