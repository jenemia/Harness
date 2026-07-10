import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderEventEnvelope, ProviderEventType } from "@harness/core";
import { ensureProjectLayout, projectHarnessPath, withProjectWriterLock } from "./project-store.js";
import { syncProjectAgentDefinitions } from "./agent-store.js";
import { assertNoCredentialMaterial, containsCredentialMaterial } from "./credential-security.js";
import type {
  AgentRecord,
  AgentTemplateRecord,
  ApprovalRecord,
  CommentRecord,
  DocumentRecord,
  DraftApplyHistoryRecord,
  DraftCommentRecord,
  DraftEventRecord,
  DraftReviewerRecord,
  DraftReviewRequestRecord,
  DraftRevisionRecord,
  DraftSessionRecord,
  EventRecord,
  GlobalSettings,
  HandoffRecord,
  InteractionRecord,
  MemoryRecord,
  ProjectListItem,
  ProjectImportCandidate,
  ProjectImportResult,
  ProjectImportSkipped,
  ProjectOverview,
  ProjectRecord,
  ProjectSettings,
  ProjectTemplateAgent,
  ProjectTemplateRecord,
  RunRecord,
  TaskRecord,
  TaskMoveDirection,
  TaskStatus,
  WorkflowTemplateRecord,
  WorkflowTemplateStep
} from "./types.js";

const appName = "Harness";

export function now() {
  return new Date().toISOString();
}

export function globalHarnessDir() {
  if (process.env.HARNESS_HOME) {
    return process.env.HARNESS_HOME;
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", appName);
  }

  return path.join(homedir(), ".harness");
}

export function openGlobalDb() {
  const dir = globalHarnessDir();
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "global.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      persona TEXT NOT NULL,
      model_backend TEXT NOT NULL,
      cli_command TEXT,
      capabilities TEXT NOT NULL,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      boundaries TEXT NOT NULL DEFAULT '',
      max_parallel INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      steps TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      agents TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "agent_templates", "allowed_tools", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_templates", "boundaries", "TEXT NOT NULL DEFAULT ''");
  seedDefaultAgentTemplates(db);
  seedDefaultWorkflowTemplates(db);
  seedDefaultProjectTemplates(db);
  purgeCredentialProviderCommands(db, "settings");
  return db;
}

function seedDefaultAgentTemplates(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM agent_templates").get() as { count: number };
  if (count.count > 0) {
    return;
  }

  const timestamp = now();
  const templates = [
    {
      name: "PM Agent",
      role: "project-manager",
      persona: "Decompose work, choose the next best agent, track blockers, and keep the Kanban board honest.",
      modelBackend: "mock",
      cliCommand: null,
      capabilities: ["planning", "assignment", "handoff"],
      allowedTools: ["kanban", "documents", "memory"],
      boundaries: "Do not run shell commands or edit project files directly; delegate implementation to worker agents.",
      maxParallel: 1
    },
    {
      name: "Programmer Agent",
      role: "programmer",
      persona: "Implement scoped engineering tasks inside the task worktree and report the result clearly.",
      modelBackend: "mock",
      cliCommand: null,
      capabilities: ["implementation", "debugging"],
      allowedTools: ["worktree", "shell", "tests"],
      boundaries: "Work only inside the assigned task worktree and report verification before handoff.",
      maxParallel: 2
    },
    {
      name: "Review Agent",
      role: "reviewer",
      persona: "Review completed work for correctness, risk, and missing verification before the task is done.",
      modelBackend: "mock",
      cliCommand: null,
      capabilities: ["review", "quality"],
      allowedTools: ["worktree", "diff", "tests"],
      boundaries: "Review and request changes when risk remains; do not merge without approval.",
      maxParallel: 1
    }
  ];
  const stmt = db.prepare(`
      INSERT INTO agent_templates (
        id, name, role, persona, model_backend, cli_command,
        capabilities, allowed_tools, boundaries, max_parallel, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const template of templates) {
    stmt.run(
      randomUUID(),
      template.name,
      template.role,
      template.persona,
      template.modelBackend,
      template.cliCommand,
      JSON.stringify(template.capabilities),
      JSON.stringify(template.allowedTools),
      template.boundaries,
      template.maxParallel,
      timestamp,
      timestamp
    );
  }
}

function seedDefaultWorkflowTemplates(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM workflow_templates").get() as { count: number };
  if (count.count > 0) {
    return;
  }

  const timestamp = now();
  const templates: Array<{
    name: string;
    description: string;
    steps: WorkflowTemplateStep[];
  }> = [
    {
      name: "Plan, Build, Review",
      description: "A careful default chain for scoped engineering work.",
      steps: [
        {
          titleTemplate: "Clarify scope: {{goalSummary}}",
          role: "project-manager",
          descriptionTemplate: "Clarify requirements, risks, dependencies, and acceptance criteria for:\n\n{{goal}}",
          acceptanceCriteria: "A clear implementation scope and acceptance checklist are recorded."
        },
        {
          titleTemplate: "Implement: {{goalSummary}}",
          role: "programmer",
          descriptionTemplate: "Implement the planned work for:\n\n{{goal}}",
          acceptanceCriteria: "The implementation is complete in the task worktree and relevant checks pass."
        },
        {
          titleTemplate: "Review and verify: {{goalSummary}}",
          role: "reviewer",
          descriptionTemplate: "Review the implementation for:\n\n{{goal}}",
          acceptanceCriteria: "The review records findings, test evidence, and merge readiness."
        }
      ]
    },
    {
      name: "Build and Review",
      description: "A faster chain for well-scoped tasks that do not need PM clarification.",
      steps: [
        {
          titleTemplate: "Implement: {{goalSummary}}",
          role: "programmer",
          descriptionTemplate: "Implement the requested work for:\n\n{{goal}}",
          acceptanceCriteria: "The implementation is complete and relevant checks pass."
        },
        {
          titleTemplate: "Review and verify: {{goalSummary}}",
          role: "reviewer",
          descriptionTemplate: "Review the implementation for correctness, risk, and missing verification:\n\n{{goal}}",
          acceptanceCriteria: "The review records findings, verification evidence, and merge readiness."
        }
      ]
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO workflow_templates (
      id, name, description, steps, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const template of templates) {
    stmt.run(
      randomUUID(),
      template.name,
      template.description,
      JSON.stringify(template.steps),
      timestamp,
      timestamp
    );
  }
}

function seedDefaultProjectTemplates(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM project_templates").get() as { count: number };
  if (count.count > 0) {
    return;
  }

  const timestamp = now();
  const templates: Array<{
    name: string;
    description: string;
    agents: ProjectTemplateAgent[];
  }> = [
    {
      name: "Software Engineering Team",
      description: "PM, programmer, and reviewer agents for local code projects.",
      agents: [
        {
          name: "PM Agent",
          role: "project-manager",
          persona: "Decompose work, choose the next best agent, track blockers, and keep the Kanban board honest.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["planning", "assignment", "handoff"],
          allowedTools: ["kanban", "documents", "memory"],
          boundaries: "Do not run shell commands or edit project files directly; delegate implementation to worker agents.",
          maxParallel: 1
        },
        {
          name: "Programmer Agent",
          role: "programmer",
          persona: "Implement scoped engineering tasks inside the task worktree and report the result clearly.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["implementation", "debugging"],
          allowedTools: ["worktree", "shell", "tests"],
          boundaries: "Work only inside the assigned task worktree and report verification before handoff.",
          maxParallel: 2
        },
        {
          name: "Review Agent",
          role: "reviewer",
          persona: "Review completed work for correctness, risk, and missing verification before the task is done.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["review", "quality"],
          allowedTools: ["worktree", "diff", "tests"],
          boundaries: "Review and request changes when risk remains; do not merge without approval.",
          maxParallel: 1
        }
      ]
    },
    {
      name: "Research Team",
      description: "Research, analysis, and writing agents for knowledge work projects.",
      agents: [
        {
          name: "Research PM",
          role: "project-manager",
          persona: "Break research goals into evidence-gathering, synthesis, and writing tasks while tracking assumptions.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["planning", "research-management"],
          allowedTools: ["kanban", "documents", "memory"],
          boundaries: "Track assumptions and uncertainty; delegate source gathering to research agents.",
          maxParallel: 1
        },
        {
          name: "Research Agent",
          role: "researcher",
          persona: "Collect sources, extract facts, and record uncertainty clearly for the rest of the team.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["research", "source-review"],
          allowedTools: ["documents", "memory"],
          boundaries: "Record source uncertainty and avoid presenting unverified claims as facts.",
          maxParallel: 2
        },
        {
          name: "Analyst Agent",
          role: "analyst",
          persona: "Synthesize research into structured findings, tradeoffs, and recommended next steps.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["analysis", "synthesis"],
          allowedTools: ["documents", "memory"],
          boundaries: "Separate evidence from inference and flag unresolved contradictions.",
          maxParallel: 1
        },
        {
          name: "Writer Agent",
          role: "writer",
          persona: "Turn validated findings into clear project documents and stakeholder-ready summaries.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["writing", "documentation"],
          allowedTools: ["documents", "memory"],
          boundaries: "Do not invent facts; use only validated findings and note gaps.",
          maxParallel: 1
        }
      ]
    },
    {
      name: "Content Production Team",
      description: "Planning, drafting, editing, and QA agents for content workflows.",
      agents: [
        {
          name: "Content PM",
          role: "project-manager",
          persona: "Plan content production, sequence drafts and reviews, and keep publication blockers visible.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["planning", "content-strategy"],
          allowedTools: ["kanban", "documents", "memory"],
          boundaries: "Keep publication risks visible and route quality decisions through review.",
          maxParallel: 1
        },
        {
          name: "Drafting Agent",
          role: "writer",
          persona: "Create clear first drafts that match the brief, audience, and acceptance criteria.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["drafting", "writing"],
          allowedTools: ["documents", "memory"],
          boundaries: "Match the brief and avoid unsupported claims or off-brand tone.",
          maxParallel: 2
        },
        {
          name: "Editor Agent",
          role: "reviewer",
          persona: "Edit for accuracy, tone, structure, and publication readiness.",
          modelBackend: "mock",
          cliCommand: null,
          capabilities: ["editing", "quality"],
          allowedTools: ["documents", "memory"],
          boundaries: "Request changes when accuracy, tone, or publication readiness is unclear.",
          maxParallel: 1
        }
      ]
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO project_templates (
      id, name, description, agents, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const template of templates) {
    stmt.run(
      randomUUID(),
      template.name,
      template.description,
      JSON.stringify(normalizeProjectTemplateAgents(template.agents)),
      timestamp,
      timestamp
    );
  }
}

export function defaultGlobalSettings(): GlobalSettings {
  return {
    defaultProjectRoot: path.join(homedir(), "Documents"),
    defaultModelBackend: "mock",
    defaultAgentMaxParallel: 1,
    autoStartPlans: false,
    largePlanTaskThreshold: 10,
    maxRunSeconds: 1800,
    providerCommands: {},
    updatedAt: null
  };
}

export function getGlobalSettings(): GlobalSettings {
  const db = openGlobalDb();
  try {
    const rows = db.prepare("SELECT key, value, updated_at FROM settings").all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    const settings = defaultGlobalSettings();
    let updatedAt: string | null = null;

    for (const row of rows) {
      if (!updatedAt || row.updated_at > updatedAt) {
        updatedAt = row.updated_at;
      }
      if (row.key === "defaultProjectRoot") {
        settings.defaultProjectRoot = row.value;
      }
      if (row.key === "defaultModelBackend") {
        settings.defaultModelBackend = row.value;
      }
      if (row.key === "defaultAgentMaxParallel") {
        settings.defaultAgentMaxParallel = Math.max(1, Number(row.value || 1));
      }
      if (row.key === "autoStartPlans") {
        settings.autoStartPlans = row.value === "true";
      }
      if (row.key === "largePlanTaskThreshold") {
        settings.largePlanTaskThreshold = Math.max(1, Number(row.value || settings.largePlanTaskThreshold));
      }
      if (row.key === "maxRunSeconds") {
        settings.maxRunSeconds = Math.max(5, Number(row.value || settings.maxRunSeconds));
      }
      if (row.key === "providerCommands") {
        settings.providerCommands = parseStringMap(row.value, settings.providerCommands);
      }
    }

    return { ...settings, updatedAt };
  } finally {
    db.close();
  }
}

export function updateGlobalSettings(input: Partial<GlobalSettings>): GlobalSettings {
  const current = getGlobalSettings();
  const db = openGlobalDb();
  try {
    if (input.providerCommands !== undefined) assertNoCredentialMaterial(input.providerCommands, "Provider commands");
    const next: GlobalSettings = {
      defaultProjectRoot: input.defaultProjectRoot?.trim() || current.defaultProjectRoot,
      defaultModelBackend: input.defaultModelBackend?.trim() || current.defaultModelBackend,
      defaultAgentMaxParallel: Math.max(1, Number(input.defaultAgentMaxParallel || current.defaultAgentMaxParallel)),
      autoStartPlans: input.autoStartPlans ?? current.autoStartPlans,
      largePlanTaskThreshold: Math.max(1, Number(input.largePlanTaskThreshold || current.largePlanTaskThreshold)),
      maxRunSeconds: Math.max(5, Number(input.maxRunSeconds || current.maxRunSeconds)),
      providerCommands: normalizeStringMap(input.providerCommands || current.providerCommands),
      updatedAt: now()
    };

    const stmt = db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?, ?)");
    stmt.run("defaultProjectRoot", next.defaultProjectRoot, next.updatedAt);
    stmt.run("defaultModelBackend", next.defaultModelBackend, next.updatedAt);
    stmt.run("defaultAgentMaxParallel", String(next.defaultAgentMaxParallel), next.updatedAt);
    stmt.run("autoStartPlans", String(next.autoStartPlans), next.updatedAt);
    stmt.run("largePlanTaskThreshold", String(next.largePlanTaskThreshold), next.updatedAt);
    stmt.run("maxRunSeconds", String(next.maxRunSeconds), next.updatedAt);
    stmt.run("providerCommands", JSON.stringify(next.providerCommands), next.updatedAt);
    return next;
  } finally {
    db.close();
  }
}

export function listAgentTemplates(): AgentTemplateRecord[] {
  const db = openGlobalDb();
  try {
    return db.prepare("SELECT * FROM agent_templates ORDER BY updated_at DESC").all().map(mapAgentTemplate);
  } finally {
    db.close();
  }
}

export function createAgentTemplate(input: Partial<AgentTemplateRecord>): AgentTemplateRecord {
  if (!input.name?.trim()) {
    throw new Error("Template name is required.");
  }

  const settings = getGlobalSettings();
  const timestamp = now();
  const template: AgentTemplateRecord = {
    id: randomUUID(),
    name: input.name.trim(),
    role: input.role?.trim() || "worker",
    persona: input.persona?.trim() || "Perform assigned work carefully and report the result.",
    modelBackend: input.modelBackend?.trim() || settings.defaultModelBackend,
    cliCommand: input.cliCommand?.trim() || null,
    capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
    allowedTools: Array.isArray(input.allowedTools) ? input.allowedTools : [],
    boundaries: input.boundaries?.trim() || "",
    maxParallel: Math.max(1, Number(input.maxParallel || settings.defaultAgentMaxParallel)),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const db = openGlobalDb();
  try {
    db.prepare(`
      INSERT INTO agent_templates (
        id, name, role, persona, model_backend, cli_command,
        capabilities, allowed_tools, boundaries, max_parallel, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.name,
      template.role,
      template.persona,
      template.modelBackend,
      template.cliCommand,
      JSON.stringify(template.capabilities),
      JSON.stringify(template.allowedTools),
      template.boundaries,
      template.maxParallel,
      template.createdAt,
      template.updatedAt
    );

    return template;
  } finally {
    db.close();
  }
}

export function listWorkflowTemplates(): WorkflowTemplateRecord[] {
  const db = openGlobalDb();
  try {
    return db.prepare("SELECT * FROM workflow_templates ORDER BY updated_at DESC").all().map(mapWorkflowTemplate);
  } finally {
    db.close();
  }
}

export function getWorkflowTemplate(templateId: string): WorkflowTemplateRecord | null {
  const db = openGlobalDb();
  try {
    const row = db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get(templateId);
    return row ? mapWorkflowTemplate(row) : null;
  } finally {
    db.close();
  }
}

export function createWorkflowTemplate(input: Partial<WorkflowTemplateRecord>): WorkflowTemplateRecord {
  if (!input.name?.trim()) {
    throw new Error("Workflow template name is required.");
  }

  const steps = normalizeWorkflowSteps(input.steps);
  if (steps.length === 0) {
    throw new Error("Workflow template needs at least one step.");
  }

  const timestamp = now();
  const template: WorkflowTemplateRecord = {
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() || "",
    steps,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const db = openGlobalDb();
  try {
    db.prepare(`
      INSERT INTO workflow_templates (
        id, name, description, steps, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.steps),
      template.createdAt,
      template.updatedAt
    );

    return template;
  } finally {
    db.close();
  }
}

export function listProjectTemplates(): ProjectTemplateRecord[] {
  const db = openGlobalDb();
  try {
    return db.prepare("SELECT * FROM project_templates ORDER BY updated_at DESC").all().map(mapProjectTemplate);
  } finally {
    db.close();
  }
}

export function getProjectTemplate(templateId: string): ProjectTemplateRecord | null {
  const db = openGlobalDb();
  try {
    const row = db.prepare("SELECT * FROM project_templates WHERE id = ?").get(templateId);
    return row ? mapProjectTemplate(row) : null;
  } finally {
    db.close();
  }
}

export function createProjectTemplate(input: Partial<ProjectTemplateRecord>): ProjectTemplateRecord {
  if (!input.name?.trim()) {
    throw new Error("Project template name is required.");
  }

  const agents = normalizeProjectTemplateAgents(input.agents);
  if (agents.length === 0) {
    throw new Error("Project template needs at least one agent.");
  }

  const timestamp = now();
  const template: ProjectTemplateRecord = {
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description?.trim() || "",
    agents,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const db = openGlobalDb();
  try {
    db.prepare(`
      INSERT INTO project_templates (
        id, name, description, agents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.agents),
      template.createdAt,
      template.updatedAt
    );

    return template;
  } finally {
    db.close();
  }
}

function seedProjectFromTemplateMutation(projectPath: string, templateId: string): ProjectTemplateRecord {
  const template = getProjectTemplate(templateId);
  if (!template) {
    throw new Error("Project template not found.");
  }

  const db = openProjectDb(projectPath);
  try {
    const count = db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number };
    if (count.count > 0) {
      return template;
    }

    const timestamp = now();
    const stmt = db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        allowed_tools, boundaries, max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const agent of template.agents) {
      stmt.run(
        randomUUID(),
        agent.name,
        agent.role,
        agent.persona,
        agent.modelBackend,
        agent.cliCommand,
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.allowedTools || []),
        agent.boundaries || "",
        agent.maxParallel,
        "idle",
        null,
        timestamp,
        timestamp
      );
    }

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "project.template.applied",
      message: `${template.name} project template created ${template.agents.length} agent(s).`,
      metadata: { projectTemplateId: template.id, agentRoles: template.agents.map((agent) => agent.role) }
    });

    return template;
  } finally {
    db.close();
  }
}

function normalizeWorkflowSteps(input: unknown): WorkflowTemplateStep[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((step) => {
      const value = step as Partial<WorkflowTemplateStep>;
      return {
        titleTemplate: value.titleTemplate?.trim() || "",
        role: value.role?.trim() || "worker",
        descriptionTemplate: value.descriptionTemplate?.trim() || "{{goal}}",
        acceptanceCriteria: value.acceptanceCriteria?.trim() || "The assigned agent reports completion and verification."
      };
    })
    .filter((step) => step.titleTemplate);
}

function normalizeProjectTemplateAgents(input: unknown): ProjectTemplateAgent[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((agent) => {
      const value = agent as Partial<ProjectTemplateAgent>;
      return {
        name: value.name?.trim() || "",
        role: value.role?.trim() || "worker",
        persona: value.persona?.trim() || "Perform assigned work carefully and report the result.",
        modelBackend: value.modelBackend?.trim() || "mock",
        cliCommand: value.cliCommand?.trim() || null,
        capabilities: Array.isArray(value.capabilities)
          ? value.capabilities.map((capability) => capability.trim()).filter(Boolean)
          : [],
        allowedTools: Array.isArray(value.allowedTools)
          ? value.allowedTools.map((tool) => tool.trim()).filter(Boolean)
          : [],
        boundaries: value.boundaries?.trim() || "",
        maxParallel: Math.max(1, Number(value.maxParallel || 1))
      };
    })
    .filter((agent) => agent.name);
}

export function projectHarnessDir(projectPath: string) {
  return projectHarnessPath(projectPath);
}

export function openProjectDb(projectPath: string) {
  const layout = ensureProjectLayout(projectPath);
  const db = new DatabaseSync(layout.databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 1;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      persona TEXT NOT NULL,
      model_backend TEXT NOT NULL,
      cli_command TEXT,
      capabilities TEXT NOT NULL,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      boundaries TEXT NOT NULL DEFAULT '',
      max_parallel INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      model_backend TEXT,
      assignee_agent_id TEXT,
      reporter TEXT NOT NULL,
      parent_task_id TEXT,
      dependency_task_ids TEXT NOT NULL DEFAULT '[]',
      waived_dependency_task_ids TEXT NOT NULL DEFAULT '[]',
      labels TEXT NOT NULL,
      linked_file_paths TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT NOT NULL,
      workspace_mode TEXT NOT NULL DEFAULT 'worktree',
      task_order INTEGER NOT NULL DEFAULT 0,
      branch_name TEXT,
      worktree_path TEXT,
      blocked_reason TEXT,
      merge_status TEXT NOT NULL DEFAULT 'none',
      merge_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      agent_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_events (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS provider_events_terminal_once
      ON provider_events(run_id) WHERE type IN ('result', 'error');

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT,
      worktree_path TEXT,
      snapshot_ref TEXT,
      model_backend TEXT,
      provider_id TEXT,
      command_preview TEXT,
      output TEXT,
      error TEXT,
      changed_files TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_agent_id TEXT,
      to_agent_id TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draft_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draft_revisions (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(draft_id, revision)
    );

    CREATE TABLE IF NOT EXISTS draft_reviewers (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT,
      status TEXT NOT NULL,
      last_requested_revision INTEGER,
      last_reviewed_revision INTEGER,
      last_request_at TEXT,
      rate_limit_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(draft_id, role)
    );

    CREATE TABLE IF NOT EXISTS draft_review_requests (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      UNIQUE(draft_id, dedupe_key)
    );

    CREATE TABLE IF NOT EXISTS draft_comments (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      reviewer_id TEXT,
      parent_comment_id TEXT,
      author TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(draft_id, dedupe_key)
    );

    CREATE TABLE IF NOT EXISTS draft_apply_history (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      target_revision INTEGER,
      selected_comment_ids TEXT NOT NULL,
      result TEXT,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      UNIQUE(draft_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS draft_events (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(draft_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS draft_review_requests_status_available
      ON draft_review_requests(status, available_at);
    CREATE INDEX IF NOT EXISTS draft_comments_session_revision
      ON draft_comments(draft_id, revision, created_at);

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      command_preview TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      interaction_id TEXT
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      run_id TEXT,
      agent_id TEXT,
      approval_id TEXT UNIQUE,
      correlation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      request_payload TEXT NOT NULL,
      response_payload TEXT,
      checkpoint TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS interactions_status_created
      ON interactions(status, created_at);
    CREATE INDEX IF NOT EXISTS interactions_task_created
      ON interactions(task_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS interactions_correlation_kind
      ON interactions(project_id, correlation_id, kind);

    CREATE TABLE IF NOT EXISTS project_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  migrateDraftReviewRequestsForConversationTurns(db);
  ensureColumn(db, "approvals", "interaction_id", "TEXT");
  db.prepare(`
    INSERT INTO project_metadata (key, value) VALUES ('project_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value != excluded.value
  `).run(layout.manifest.projectId);
  migrateApprovalsToInteractions(db, layout.manifest.projectId);
  installApprovalInteractionTriggers(db);
  ensureColumn(db, "agents", "allowed_tools", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agents", "boundaries", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "agents", "definition_path", "TEXT");
  ensureColumn(db, "agents", "definition_hash", "TEXT");
  ensureColumn(db, "agents", "definition_schema_version", "INTEGER");
  ensureColumn(db, "agents", "parse_status", "TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn(db, "agents", "parse_error", "TEXT");
  ensureColumn(db, "agents", "enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "tasks", "dependency_task_ids", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "waived_dependency_task_ids", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "linked_file_paths", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "model_backend", "TEXT");
  ensureColumn(db, "tasks", "workspace_mode", "TEXT NOT NULL DEFAULT 'worktree'");
  ensureColumn(db, "tasks", "task_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "blocked_reason", "TEXT");
  ensureColumn(db, "tasks", "merge_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "tasks", "merge_error", "TEXT");
  ensureColumn(db, "runs", "snapshot_ref", "TEXT");
  ensureColumn(db, "runs", "model_backend", "TEXT");
  ensureColumn(db, "runs", "provider_id", "TEXT");
  ensureColumn(db, "runs", "command_preview", "TEXT");
  ensureColumn(db, "runs", "changed_files", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "runs", "agent_definition_hash", "TEXT");
  ensureColumn(db, "runs", "agent_definition_schema_version", "INTEGER");
  ensureColumn(db, "runs", "agent_definition_snapshot", "TEXT");
  purgeCredentialProviderCommands(db, "project_settings");
  syncProjectAgentDefinitions(db, projectPath);
  return db;
}

export function defaultProjectSettings(): ProjectSettings {
  const globalSettings = getGlobalSettings();
  return {
    defaultModelBackend: globalSettings.defaultModelBackend,
    defaultAgentMaxParallel: globalSettings.defaultAgentMaxParallel,
    autoStartPlans: globalSettings.autoStartPlans,
    requireCommandApproval: true,
    maxProjectParallel: 4,
    largePlanTaskThreshold: globalSettings.largePlanTaskThreshold,
    maxRunSeconds: globalSettings.maxRunSeconds,
    handoffRules: {
      programmer: "reviewer",
      worker: "reviewer"
    },
    providerCommands: globalSettings.providerCommands,
    updatedAt: null
  };
}

export function getProjectSettings(projectPath: string): ProjectSettings {
  const db = openProjectDb(projectPath);
  try {
    return getProjectSettingsFromDb(db);
  } finally {
    db.close();
  }
}

export function getProjectSettingsFromDb(db: DatabaseSync): ProjectSettings {
  const rows = db.prepare("SELECT key, value, updated_at FROM project_settings").all() as Array<{
    key: string;
    value: string;
    updated_at: string;
  }>;
  const settings = defaultProjectSettings();
  let updatedAt: string | null = null;

  for (const row of rows) {
    if (!updatedAt || row.updated_at > updatedAt) {
      updatedAt = row.updated_at;
    }
    if (row.key === "defaultModelBackend") {
      settings.defaultModelBackend = row.value;
    }
    if (row.key === "defaultAgentMaxParallel") {
      settings.defaultAgentMaxParallel = Math.max(1, Number(row.value || 1));
    }
    if (row.key === "autoStartPlans") {
      settings.autoStartPlans = row.value === "true";
    }
    if (row.key === "requireCommandApproval") {
      settings.requireCommandApproval = row.value === "true";
    }
    if (row.key === "maxProjectParallel") {
      settings.maxProjectParallel = Math.max(1, Number(row.value || 1));
    }
    if (row.key === "largePlanTaskThreshold") {
      settings.largePlanTaskThreshold = Math.max(1, Number(row.value || settings.largePlanTaskThreshold));
    }
    if (row.key === "maxRunSeconds") {
      settings.maxRunSeconds = Math.max(5, Number(row.value || settings.maxRunSeconds));
    }
    if (row.key === "handoffRules") {
      settings.handoffRules = parseStringMap(row.value, settings.handoffRules);
    }
    if (row.key === "providerCommands") {
      settings.providerCommands = {
        ...settings.providerCommands,
        ...parseStringMap(row.value, {})
      };
    }
  }

  return { ...settings, updatedAt };
}

function getProjectProviderCommandOverridesFromDb(db: DatabaseSync) {
  const row = db.prepare("SELECT value FROM project_settings WHERE key = ?").get("providerCommands") as
    | { value: string }
    | undefined;
  return parseStringMap(row?.value || "{}", {});
}

function updateProjectSettingsMutation(projectPath: string, input: Partial<ProjectSettings>): ProjectSettings {
  const db = openProjectDb(projectPath);
  try {
    const current = getProjectSettingsFromDb(db);
    if (input.providerCommands !== undefined) assertNoCredentialMaterial(input.providerCommands, "Provider commands");
    const providerCommandOverrides =
      input.providerCommands !== undefined
        ? normalizeStringMap(input.providerCommands)
        : getProjectProviderCommandOverridesFromDb(db);
    const timestamp = now();
    const next: ProjectSettings = {
      defaultModelBackend: input.defaultModelBackend?.trim() || current.defaultModelBackend,
      defaultAgentMaxParallel: Math.max(1, Number(input.defaultAgentMaxParallel || current.defaultAgentMaxParallel)),
      autoStartPlans: input.autoStartPlans ?? current.autoStartPlans,
      requireCommandApproval: input.requireCommandApproval ?? current.requireCommandApproval,
      maxProjectParallel: Math.max(1, Number(input.maxProjectParallel || current.maxProjectParallel)),
      largePlanTaskThreshold: Math.max(1, Number(input.largePlanTaskThreshold || current.largePlanTaskThreshold)),
      maxRunSeconds: Math.max(5, Number(input.maxRunSeconds || current.maxRunSeconds)),
      handoffRules: normalizeStringMap(input.handoffRules || current.handoffRules),
      providerCommands: {
        ...defaultProjectSettings().providerCommands,
        ...providerCommandOverrides
      },
      updatedAt: timestamp
    };

    const stmt = db.prepare("INSERT OR REPLACE INTO project_settings VALUES (?, ?, ?)");
    stmt.run("defaultModelBackend", next.defaultModelBackend, timestamp);
    stmt.run("defaultAgentMaxParallel", String(next.defaultAgentMaxParallel), timestamp);
    stmt.run("autoStartPlans", String(next.autoStartPlans), timestamp);
    stmt.run("requireCommandApproval", String(next.requireCommandApproval), timestamp);
    stmt.run("maxProjectParallel", String(next.maxProjectParallel), timestamp);
    stmt.run("largePlanTaskThreshold", String(next.largePlanTaskThreshold), timestamp);
    stmt.run("maxRunSeconds", String(next.maxRunSeconds), timestamp);
    stmt.run("handoffRules", JSON.stringify(next.handoffRules), timestamp);
    stmt.run("providerCommands", JSON.stringify(providerCommandOverrides), timestamp);
    return next;
  } finally {
    db.close();
  }
}

function parseStringMap(value: string, fallback: Record<string, string>) {
  try {
    return normalizeStringMap(JSON.parse(value));
  } catch {
    return fallback;
  }
}

function normalizeStringMap(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([fromRole, toRole]) => [fromRole.trim(), typeof toRole === "string" ? toRole.trim() : ""])
      .filter(([fromRole, toRole]) => fromRole && toRole)
  );
}

function migrateDraftReviewRequestsForConversationTurns(db: DatabaseSync) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'draft_review_requests'").get() as
    | { sql: string }
    | undefined;
  if (!row?.sql || !/UNIQUE\s*\(\s*draft_id\s*,\s*reviewer_id\s*,\s*revision\s*\)/i.test(row.sql)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      ALTER TABLE draft_review_requests RENAME TO draft_review_requests_legacy;
      CREATE TABLE draft_review_requests (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        available_at TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        UNIQUE(draft_id, dedupe_key)
      );
      INSERT INTO draft_review_requests
      SELECT id, draft_id, reviewer_id, revision, status, available_at, dedupe_key,
             requested_at, started_at, completed_at, error
      FROM draft_review_requests_legacy;
      DROP TABLE draft_review_requests_legacy;
      CREATE INDEX IF NOT EXISTS draft_review_requests_status_available
        ON draft_review_requests(status, available_at);
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateApprovalsToInteractions(db: DatabaseSync, projectId: string) {
  const approvals = db.prepare("SELECT * FROM approvals WHERE interaction_id IS NULL ORDER BY created_at ASC").all() as Array<
    Record<string, string | null>
  >;
  if (!approvals.length) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const approval of approvals) {
      const interactionId = randomUUID();
      const approvalStatus = String(approval.status);
      const interactionStatus = approvalStatus === "approved" ? "resolved" : approvalStatus === "rejected" ? "rejected" : "pending";
      const responsePayload = approvalStatus === "pending" ? null : JSON.stringify({ decision: approvalStatus });
      db.prepare(`
        INSERT INTO interactions (
          id, project_id, task_id, run_id, agent_id, approval_id, correlation_id,
          kind, status, request_payload, response_payload, checkpoint, expires_at,
          created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        interactionId,
        projectId,
        approval.task_id,
        null,
        approval.agent_id,
        approval.id,
        `approval:${approval.id}`,
        "approval",
        interactionStatus,
        JSON.stringify({
          approvalKind: approval.kind,
          reason: approval.reason,
          commandPreview: approval.command_preview
        }),
        responsePayload,
        null,
        null,
        approval.created_at,
        approval.decided_at
      );
      db.prepare("UPDATE approvals SET interaction_id = ? WHERE id = ?").run(interactionId, approval.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function installApprovalInteractionTriggers(db: DatabaseSync) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS approval_interaction_status_update
    AFTER UPDATE OF status, decided_at ON approvals
    WHEN NEW.interaction_id IS NOT NULL
    BEGIN
      UPDATE interactions
      SET status = CASE
            WHEN NEW.status = 'approved' THEN 'resolved'
            WHEN NEW.status = 'rejected' THEN 'rejected'
            ELSE 'pending'
          END,
          response_payload = CASE
            WHEN NEW.status = 'approved' THEN '{"decision":"approved"}'
            WHEN NEW.status = 'rejected' THEN '{"decision":"rejected"}'
            ELSE NULL
          END,
          resolved_at = CASE WHEN NEW.status = 'pending' THEN NULL ELSE NEW.decided_at END
      WHERE id = NEW.interaction_id;
    END;
  `);
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function purgeCredentialProviderCommands(db: DatabaseSync, tableName: "settings" | "project_settings") {
  const row = db.prepare(`SELECT value FROM ${tableName} WHERE key = ?`).get("providerCommands") as { value: string } | undefined;
  if (!row || !containsCredentialMaterial(row.value)) return;
  const commands = parseStringMap(row.value, {});
  const safeCommands = Object.fromEntries(Object.entries(commands).filter(([, command]) => !containsCredentialMaterial(command)));
  db.prepare(`UPDATE ${tableName} SET value = ?, updated_at = ? WHERE key = ?`).run(
    JSON.stringify(safeCommands),
    now(),
    "providerCommands"
  );
}

export function listProjects(): ProjectRecord[] {
  const db = openGlobalDb();
  try {
    return db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects ORDER BY updated_at DESC")
      .all()
      .map(mapProject);
  } finally {
    db.close();
  }
}

export function listProjectsWithSummaries(): ProjectListItem[] {
  return listProjects().map((project) => ({
    ...project,
    summary: getProjectSummary(project.path)
  }));
}

function getProjectSummary(projectPath: string) {
  const pathExists = existsSync(projectPath);
  const harnessDbPath = path.join(projectHarnessDir(projectPath), "harness.db");
  const harnessDbExists = existsSync(harnessDbPath);
  const emptySummary = {
    pathExists,
    harnessDbExists,
    summaryError: null,
    totalTasks: 0,
    backlogTasks: 0,
    selectedTasks: 0,
    blockedTasks: 0,
    runningTasks: 0,
    failedRuns: 0,
    pendingApprovals: 0,
    pendingMerges: 0,
    followUpBacklogTasks: 0,
    busyAgents: 0
  };

  if (!pathExists || !harnessDbExists) {
    return emptySummary;
  }

  let db: DatabaseSync | null = null;
  try {
    db = openProjectDb(projectPath);
    const projectDb = db;
    const count = (sql: string, ...params: string[]) => {
      const row = projectDb.prepare(sql).get(...params) as { count: number };
      return Number(row.count || 0);
    };

    return {
      pathExists,
      harnessDbExists,
      summaryError: null,
      totalTasks: count("SELECT COUNT(*) AS count FROM tasks"),
      backlogTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = ?", "Backlog"),
      selectedTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = ?", "Selected"),
      blockedTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = ?", "Blocked"),
      runningTasks: count("SELECT COUNT(*) AS count FROM runs WHERE status = ?", "running"),
      failedRuns: count("SELECT COUNT(*) AS count FROM runs WHERE status = ?", "failed"),
      pendingApprovals: count("SELECT COUNT(*) AS count FROM approvals WHERE status = ?", "pending"),
      pendingMerges: count("SELECT COUNT(*) AS count FROM tasks WHERE merge_status IN (?, ?)", "pending", "conflict"),
      followUpBacklogTasks: count(
        "SELECT COUNT(*) AS count FROM tasks WHERE status = ? AND labels LIKE ?",
        "Backlog",
        '%"follow-up"%'
      ),
      busyAgents: count("SELECT COUNT(*) AS count FROM agents WHERE status = ?", "busy")
    };
  } catch (error) {
    return {
      ...emptySummary,
      summaryError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    db?.close();
  }
}

export function getProject(projectId: string): ProjectRecord | null {
  const db = openGlobalDb();
  try {
    const row = db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?")
      .get(projectId);
    return row ? mapProject(row) : null;
  } finally {
    db.close();
  }
}

function registerProjectUnlocked(projectPath: string, name: string): ProjectRecord {
  const db = openGlobalDb();
  const timestamp = now();
  const normalizedPath = path.resolve(projectPath);
  const existing = db
    .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE path = ?")
    .get(normalizedPath);

  if (existing) {
    const project = mapProject(existing);
    db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, timestamp, project.id);
    db.close();
    ensureProjectLayout(project.path, project.id);
    openProjectDb(project.path).close();
    return { ...project, name, updatedAt: timestamp };
  }

  let layout = ensureProjectLayout(normalizedPath);
  const manifestProject = db
    .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?")
    .get(layout.manifest.projectId);
  if (manifestProject) {
    const registered = mapProject(manifestProject);
    if (!existsSync(registered.path)) {
      db.prepare("UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE id = ?").run(
        name,
        normalizedPath,
        timestamp,
        registered.id
      );
      db.close();
      openProjectDb(normalizedPath).close();
      return { ...registered, name, path: normalizedPath, updatedAt: timestamp };
    }
    layout = ensureProjectLayout(normalizedPath, randomUUID());
  }

  const project: ProjectRecord = {
    id: layout.manifest.projectId,
    name,
    path: normalizedPath,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?)").run(
    project.id,
    project.name,
    project.path,
    project.createdAt,
    project.updatedAt
  );
  db.close();
  openProjectDb(project.path).close();
  return project;
}

export function registerProject(projectPath: string, name: string): ProjectRecord {
  const normalizedPath = path.resolve(projectPath);
  return withProjectWriterLock(normalizedPath, () => registerProjectUnlocked(normalizedPath, name));
}

export function importProjectsFromRoot(input: {
  root?: string;
  includePlainFolders?: boolean;
  seedDefaults?: boolean;
  projectTemplateId?: string | null;
} = {}): ProjectImportResult {
  const root = path.resolve(input.root?.trim() || getGlobalSettings().defaultProjectRoot);
  if (!existsSync(root)) {
    throw new Error(`Project root does not exist: ${root}`);
  }

  const registeredPaths = new Set(listProjects().map((project) => path.resolve(project.path)));
  const candidates = discoverProjectCandidates(root, Boolean(input.includePlainFolders));
  const imported: ProjectRecord[] = [];
  const skipped: ProjectImportSkipped[] = [];

  for (const candidate of candidates) {
    if (registeredPaths.has(candidate.path)) {
      skipped.push({ ...candidate, reason: "already-registered" });
      continue;
    }

    if (candidate.source === "plain" && !input.includePlainFolders) {
      skipped.push({ ...candidate, reason: "not-project-folder" });
      continue;
    }

    const project = registerProject(candidate.path, candidate.name);
    if (input.projectTemplateId) {
      seedProjectFromTemplate(project.path, input.projectTemplateId);
    } else if (input.seedDefaults !== false) {
      seedDefaultAgents(project.path);
    }
    imported.push(project);
    registeredPaths.add(candidate.path);
  }

  return {
    root,
    imported,
    skipped,
    projects: listProjectsWithSummaries()
  };
}

function discoverProjectCandidates(root: string, includePlainFolders: boolean): ProjectImportCandidate[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const projectPath = path.join(root, entry.name);
      const harnessDbExists = existsSync(path.join(projectHarnessDir(projectPath), "harness.db"));
      const gitExists = existsSync(path.join(projectPath, ".git"));
      const source: ProjectImportCandidate["source"] | null = harnessDbExists
        ? "harness"
        : gitExists
          ? "git"
          : includePlainFolders
            ? "plain"
            : null;
      return source
        ? {
            name: entry.name,
            path: projectPath,
            source
          }
        : null;
    })
    .filter((candidate): candidate is ProjectImportCandidate => Boolean(candidate));
}

export function unregisterProject(projectId: string): ProjectRecord {
  const db = openGlobalDb();
  try {
    const row = db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?")
      .get(projectId);
    if (!row) {
      throw new Error("Project not found.");
    }

    const project = mapProject(row);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    return project;
  } finally {
    db.close();
  }
}

export function updateProjectRecord(projectId: string, input: { name?: string; path?: string }): ProjectRecord {
  const db = openGlobalDb();
  try {
    const row = db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?")
      .get(projectId);
    if (!row) {
      throw new Error("Project not found.");
    }

    const current = mapProject(row);
    const updatedAt = now();
    const next: ProjectRecord = {
      ...current,
      name: input.name?.trim() || current.name,
      path: input.path?.trim() || current.path,
      updatedAt
    };

    db.prepare("UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE id = ?").run(
      next.name,
      next.path,
      next.updatedAt,
      next.id
    );

    return next;
  } finally {
    db.close();
  }
}

export function nextTaskOrder(db: DatabaseSync) {
  const row = db.prepare("SELECT MAX(task_order) AS max_order FROM tasks").get() as { max_order: number | null };
  return Number(row.max_order || 0) + 1000;
}

function moveTaskInBoardMutation(projectPath: string, taskId: string, direction: TaskMoveDirection) {
  const db = openProjectDb(projectPath);
  try {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!taskRow) {
      throw new Error("Task not found.");
    }
    const task = mapTask(taskRow);
    normalizeTaskOrderForStatus(db, task.status);
    const rows = db
      .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY task_order ASC, created_at ASC")
      .all(task.status)
      .map(mapTask);
    const index = rows.findIndex((item) => item.id === task.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const target = rows[targetIndex];
    if (index < 0 || !target) {
      return {
        moved: false,
        reason: direction === "up" ? "Task is already first in its column." : "Task is already last in its column.",
        task
      };
    }

    const timestamp = now();
    db.prepare("UPDATE tasks SET task_order = ?, updated_at = ? WHERE id = ?").run(target.taskOrder, timestamp, task.id);
    db.prepare("UPDATE tasks SET task_order = ?, updated_at = ? WHERE id = ?").run(rows[index].taskOrder, timestamp, target.id);
    const movedTask = mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id));
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.reordered",
      message: `Task moved ${direction} in ${task.status}.`,
      metadata: { direction, status: task.status, swappedWithTaskId: target.id }
    });
    return { moved: true, task: movedTask, swappedWithTaskId: target.id };
  } finally {
    db.close();
  }
}

function normalizeTaskOrderForStatus(db: DatabaseSync, status: TaskStatus) {
  const rows = db.prepare("SELECT id, task_order FROM tasks WHERE status = ? ORDER BY task_order ASC, created_at ASC").all(status) as Array<{
    id: string;
    task_order: number;
  }>;
  for (const [index, row] of rows.entries()) {
    const nextOrder = (index + 1) * 1000;
    if (Number(row.task_order || 0) !== nextOrder) {
      db.prepare("UPDATE tasks SET task_order = ? WHERE id = ?").run(nextOrder, row.id);
    }
  }
}

export function getProjectOverview(project: ProjectRecord): ProjectOverview {
  const db = openProjectDb(project.path);
  try {
    return {
      project,
      settings: getProjectSettingsFromDb(db),
      agents: db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent),
      tasks: db.prepare("SELECT * FROM tasks ORDER BY task_order ASC, created_at ASC").all().map(mapTask),
      documents: db.prepare("SELECT * FROM documents ORDER BY updated_at DESC").all().map(mapDocument),
      memories: db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory),
      globalMemories: listGlobalMemories(),
      approvals: db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100").all().map(mapApproval),
      interactions: db.prepare("SELECT * FROM interactions ORDER BY created_at DESC LIMIT 500").all().map(mapInteraction),
      handoffs: db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC LIMIT 100").all().map(mapHandoff),
      comments: db.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT 200").all().map(mapComment),
      events: db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT 200").all().map(mapEvent),
      providerEvents: db.prepare("SELECT * FROM provider_events ORDER BY timestamp DESC, sequence DESC LIMIT 500").all().map(mapProviderEvent),
      draftSessions: db.prepare("SELECT * FROM draft_sessions ORDER BY updated_at DESC LIMIT 100").all().map(mapDraftSession),
      draftRevisions: db.prepare("SELECT * FROM draft_revisions ORDER BY created_at DESC LIMIT 500").all().map(mapDraftRevision),
      draftReviewers: db.prepare("SELECT * FROM draft_reviewers ORDER BY created_at ASC LIMIT 300").all().map(mapDraftReviewer),
      draftReviewRequests: db.prepare("SELECT * FROM draft_review_requests ORDER BY requested_at DESC LIMIT 500").all().map(mapDraftReviewRequest),
      draftComments: db.prepare("SELECT * FROM draft_comments ORDER BY created_at ASC LIMIT 1000").all().map(mapDraftComment),
      draftApplyHistory: db.prepare("SELECT * FROM draft_apply_history ORDER BY created_at DESC LIMIT 500").all().map(mapDraftApplyHistory),
      draftEvents: db.prepare("SELECT * FROM draft_events ORDER BY created_at DESC, sequence DESC LIMIT 1000").all().map(mapDraftEvent),
      runs: db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 100").all().map(mapRun)
    };
  } finally {
    db.close();
  }
}

function mapProviderEvent(row: unknown): ProviderEventEnvelope {
  const value = row as Record<string, string | number | null>;
  return {
    version: Number(value.version) as 1,
    sequence: Number(value.sequence),
    projectId: String(value.project_id),
    taskId: String(value.task_id),
    runId: String(value.run_id),
    providerId: String(value.provider_id),
    timestamp: String(value.timestamp),
    correlationId: String(value.correlation_id),
    type: String(value.type) as ProviderEventType,
    payload: JSON.parse(String(value.payload)) as Record<string, unknown>,
    metadata: JSON.parse(String(value.metadata || "{}")) as { originalEventType?: string }
  };
}

export function listGlobalMemories() {
  const db = openGlobalDb();
  try {
    return db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory);
  } finally {
    db.close();
  }
}

export function createGlobalMemory(input: Pick<MemoryRecord, "title" | "content">) {
  if (!input.title.trim()) {
    throw new Error("Memory title is required.");
  }

  const db = openGlobalDb();
  try {
    const timestamp = now();
    const id = randomUUID();
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.title.trim(),
      input.content,
      timestamp,
      timestamp
    );
    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

export function updateGlobalMemory(memoryId: string, input: Partial<Pick<MemoryRecord, "title" | "content">>) {
  const db = openGlobalDb();
  try {
    const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId);
    if (!existing) {
      throw new Error("Memory not found.");
    }

    db.prepare(`
      UPDATE memories
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          updated_at = ?
      WHERE id = ?
    `).run(input.title?.trim() || null, input.content ?? null, now(), memoryId);
    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId));
  } finally {
    db.close();
  }
}

function seedDefaultAgentsMutation(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    const count = db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number };
    if (count.count > 0) {
      return;
    }

    const timestamp = now();
    const agents = [
      {
        id: randomUUID(),
        name: "PM Agent",
        role: "project-manager",
        persona: "Decompose work, choose the next best agent, track blockers, and keep the Kanban board honest.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["planning", "assignment", "handoff"],
        allowedTools: ["kanban", "documents", "memory"],
        boundaries: "Do not run shell commands or edit project files directly; delegate implementation to worker agents.",
        maxParallel: 1
      },
      {
        id: randomUUID(),
        name: "Programmer Agent",
        role: "programmer",
        persona: "Implement scoped engineering tasks inside the task worktree and report the result clearly.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["implementation", "debugging"],
        allowedTools: ["worktree", "shell", "tests"],
        boundaries: "Work only inside the assigned task worktree and report verification before handoff.",
        maxParallel: 2
      },
      {
        id: randomUUID(),
        name: "Review Agent",
        role: "reviewer",
        persona: "Review completed work for correctness, risk, and missing verification before the task is done.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["review", "quality"],
        allowedTools: ["worktree", "diff", "tests"],
        boundaries: "Review and request changes when risk remains; do not merge without approval.",
        maxParallel: 1
      }
    ];

    const stmt = db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        allowed_tools, boundaries, max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const agent of agents) {
      stmt.run(
        agent.id,
        agent.name,
        agent.role,
        agent.persona,
        agent.modelBackend,
        agent.cliCommand,
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.allowedTools),
        agent.boundaries,
        agent.maxParallel,
        "idle",
        null,
        timestamp,
        timestamp
      );
    }

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "project.seeded",
      message: "Default PM, programmer, and review agents were created.",
      metadata: {}
    });
  } finally {
    db.close();
  }
}

function projectPathMutation<TArgs extends unknown[], TResult>(
  operation: (projectPath: string, ...args: TArgs) => TResult
) {
  return (projectPath: string, ...args: TArgs) =>
    withProjectWriterLock(projectPath, () => operation(projectPath, ...args));
}

export const seedProjectFromTemplate = projectPathMutation(seedProjectFromTemplateMutation);
export const updateProjectSettings = projectPathMutation(updateProjectSettingsMutation);
export const moveTaskInBoard = projectPathMutation(moveTaskInBoardMutation);
export const seedDefaultAgents = projectPathMutation(seedDefaultAgentsMutation);

export function insertEvent(
  db: DatabaseSync,
  input: {
    taskId: string | null;
    agentId: string | null;
    type: string;
    message: string;
    metadata: Record<string, unknown>;
  }
) {
  db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(),
    input.taskId,
    input.agentId,
    input.type,
    input.message,
    JSON.stringify(input.metadata),
    now()
  );
}

export function mapProject(row: unknown): ProjectRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapAgent(row: unknown): AgentRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role),
    persona: String(r.persona),
    modelBackend: String(r.model_backend),
    cliCommand: r.cli_command ? String(r.cli_command) : null,
    capabilities: parseJsonStringArray(r.capabilities),
    allowedTools: parseJsonStringArray(r.allowed_tools),
    boundaries: r.boundaries ? String(r.boundaries) : "",
    maxParallel: Number(r.max_parallel),
    enabled: Number(r.enabled ?? 1) !== 0,
    status: String(r.status) as AgentRecord["status"],
    currentTaskId: r.current_task_id ? String(r.current_task_id) : null,
    definitionPath: r.definition_path ? String(r.definition_path) : null,
    definitionHash: r.definition_hash ? String(r.definition_hash) : null,
    definitionSchemaVersion:
      r.definition_schema_version === null || r.definition_schema_version === undefined
        ? null
        : Number(r.definition_schema_version),
    parseStatus: (r.parse_status ? String(r.parse_status) : "legacy") as AgentRecord["parseStatus"],
    parseError: r.parse_error ? String(r.parse_error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapAgentTemplate(row: unknown): AgentTemplateRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role),
    persona: String(r.persona),
    modelBackend: String(r.model_backend),
    cliCommand: r.cli_command ? String(r.cli_command) : null,
    capabilities: parseJsonStringArray(r.capabilities),
    allowedTools: parseJsonStringArray(r.allowed_tools),
    boundaries: r.boundaries ? String(r.boundaries) : "",
    maxParallel: Number(r.max_parallel),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

function parseJsonStringArray(value: unknown) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function mapWorkflowTemplate(row: unknown): WorkflowTemplateRecord {
  const r = row as Record<string, string>;
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    steps: normalizeWorkflowSteps(JSON.parse(String(r.steps || "[]"))),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapProjectTemplate(row: unknown): ProjectTemplateRecord {
  const r = row as Record<string, string>;
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    agents: normalizeProjectTemplateAgents(JSON.parse(String(r.agents || "[]"))),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapTask(row: unknown): TaskRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    title: String(r.title),
    description: String(r.description),
    status: String(r.status) as TaskStatus,
    priority: String(r.priority) as TaskRecord["priority"],
    modelBackend: r.model_backend ? String(r.model_backend) : null,
    assigneeAgentId: r.assignee_agent_id ? String(r.assignee_agent_id) : null,
    reporter: String(r.reporter),
    parentTaskId: r.parent_task_id ? String(r.parent_task_id) : null,
    dependencyTaskIds: JSON.parse(String(r.dependency_task_ids || "[]")) as string[],
    waivedDependencyTaskIds: JSON.parse(String(r.waived_dependency_task_ids || "[]")) as string[],
    labels: JSON.parse(String(r.labels)) as string[],
    linkedFiles: parseJsonStringArray(r.linked_file_paths),
    acceptanceCriteria: String(r.acceptance_criteria),
    workspaceMode: r.workspace_mode === "harness" ? "harness" : "worktree",
    taskOrder: Number(r.task_order || 0),
    branchName: r.branch_name ? String(r.branch_name) : null,
    worktreePath: r.worktree_path ? String(r.worktree_path) : null,
    blockedReason: r.blocked_reason ? String(r.blocked_reason) : null,
    mergeStatus: String(r.merge_status || "none") as TaskRecord["mergeStatus"],
    mergeError: r.merge_error ? String(r.merge_error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapDocument(row: unknown): DocumentRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapMemory(row: unknown): MemoryRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapApproval(row: unknown): ApprovalRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    agentId: String(r.agent_id),
    kind: String(r.kind) as ApprovalRecord["kind"],
    status: String(r.status) as ApprovalRecord["status"],
    reason: String(r.reason),
    commandPreview: r.command_preview ? String(r.command_preview) : null,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    interactionId: r.interaction_id ? String(r.interaction_id) : null
  };
}

export function mapInteraction(row: unknown): InteractionRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    taskId: r.task_id ? String(r.task_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    approvalId: r.approval_id ? String(r.approval_id) : null,
    correlationId: String(r.correlation_id),
    kind: String(r.kind) as InteractionRecord["kind"],
    status: String(r.status) as InteractionRecord["status"],
    requestPayload: JSON.parse(String(r.request_payload || "{}")) as Record<string, unknown>,
    responsePayload: r.response_payload ? JSON.parse(String(r.response_payload)) as Record<string, unknown> : null,
    checkpoint: r.checkpoint ? JSON.parse(String(r.checkpoint)) as Record<string, unknown> : null,
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    createdAt: String(r.created_at),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null
  };
}

export function mapHandoff(row: unknown): HandoffRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    fromAgentId: r.from_agent_id ? String(r.from_agent_id) : null,
    toAgentId: r.to_agent_id ? String(r.to_agent_id) : null,
    reason: String(r.reason),
    createdAt: String(r.created_at)
  };
}

export function mapComment(row: unknown): CommentRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    taskId: r.task_id,
    author: r.author,
    body: r.body,
    createdAt: r.created_at
  };
}

export function mapEvent(row: unknown): EventRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: r.task_id ? String(r.task_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    type: String(r.type),
    message: String(r.message),
    metadata: JSON.parse(String(r.metadata)) as Record<string, unknown>,
    createdAt: String(r.created_at)
  };
}

export function mapRun(row: unknown): RunRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    agentId: String(r.agent_id),
    status: String(r.status) as RunRecord["status"],
    branchName: r.branch_name ? String(r.branch_name) : null,
    worktreePath: r.worktree_path ? String(r.worktree_path) : null,
    snapshotRef: r.snapshot_ref ? String(r.snapshot_ref) : null,
    modelBackend: r.model_backend ? String(r.model_backend) : null,
    providerId: r.provider_id ? String(r.provider_id) : null,
    commandPreview: r.command_preview ? String(r.command_preview) : null,
    output: r.output ? String(r.output) : null,
    error: r.error ? String(r.error) : null,
    changedFiles: JSON.parse(String(r.changed_files || "[]")) as string[],
    agentDefinitionHash: r.agent_definition_hash ? String(r.agent_definition_hash) : null,
    agentDefinitionSchemaVersion:
      r.agent_definition_schema_version === null || r.agent_definition_schema_version === undefined
        ? null
        : Number(r.agent_definition_schema_version),
    agentDefinitionSnapshot: r.agent_definition_snapshot ? String(r.agent_definition_snapshot) : null,
    startedAt: String(r.started_at),
    completedAt: r.completed_at ? String(r.completed_at) : null
  };
}

export function mapDraftSession(row: unknown): DraftSessionRecord {
  const r = row as Record<string, string | number>;
  return {
    id: String(r.id), projectId: String(r.project_id), status: String(r.status) as DraftSessionRecord["status"],
    currentRevision: Number(r.current_revision), createdAt: String(r.created_at), updatedAt: String(r.updated_at)
  };
}

export function mapDraftRevision(row: unknown): DraftRevisionRecord {
  const r = row as Record<string, string | number>;
  return {
    id: String(r.id), draftId: String(r.draft_id), revision: Number(r.revision),
    content: String(r.content), createdAt: String(r.created_at)
  };
}

export function mapDraftReviewer(row: unknown): DraftReviewerRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id), draftId: String(r.draft_id), role: String(r.role) as DraftReviewerRecord["role"],
    agentId: r.agent_id ? String(r.agent_id) : null,
    status: String(r.status) as DraftReviewerRecord["status"],
    lastRequestedRevision: r.last_requested_revision === null ? null : Number(r.last_requested_revision),
    lastReviewedRevision: r.last_reviewed_revision === null ? null : Number(r.last_reviewed_revision),
    lastRequestAt: r.last_request_at ? String(r.last_request_at) : null,
    rateLimitUntil: r.rate_limit_until ? String(r.rate_limit_until) : null,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at)
  };
}

export function mapDraftReviewRequest(row: unknown): DraftReviewRequestRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id), draftId: String(r.draft_id), reviewerId: String(r.reviewer_id), revision: Number(r.revision),
    status: String(r.status) as DraftReviewRequestRecord["status"], availableAt: String(r.available_at),
    dedupeKey: String(r.dedupe_key), requestedAt: String(r.requested_at),
    startedAt: r.started_at ? String(r.started_at) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
    error: r.error ? String(r.error) : null
  };
}

export function mapDraftComment(row: unknown): DraftCommentRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id), draftId: String(r.draft_id), revision: Number(r.revision),
    reviewerId: r.reviewer_id ? String(r.reviewer_id) : null,
    parentCommentId: r.parent_comment_id ? String(r.parent_comment_id) : null,
    author: String(r.author), kind: String(r.kind) as DraftCommentRecord["kind"],
    status: String(r.status) as DraftCommentRecord["status"], body: String(r.body),
    dedupeKey: String(r.dedupe_key), stale: Number(r.stale) !== 0,
    createdAt: String(r.created_at), updatedAt: String(r.updated_at)
  };
}

export function mapDraftApplyHistory(row: unknown): DraftApplyHistoryRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id), draftId: String(r.draft_id), sourceRevision: Number(r.source_revision),
    targetRevision: r.target_revision === null ? null : Number(r.target_revision),
    selectedCommentIds: JSON.parse(String(r.selected_comment_ids || "[]")) as string[],
    result: r.result ? JSON.parse(String(r.result)) as DraftApplyHistoryRecord["result"] : null,
    status: String(r.status) as DraftApplyHistoryRecord["status"], idempotencyKey: String(r.idempotency_key),
    createdAt: String(r.created_at), appliedAt: r.applied_at ? String(r.applied_at) : null
  };
}

export function mapDraftEvent(row: unknown): DraftEventRecord {
  const r = row as Record<string, string | number>;
  return {
    id: String(r.id), draftId: String(r.draft_id), sequence: Number(r.sequence), type: String(r.type),
    payload: JSON.parse(String(r.payload || "{}")) as Record<string, unknown>, createdAt: String(r.created_at)
  };
}
