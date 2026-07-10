import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { projectHarnessPath } from "./project-store.js";
import type { AgentRecord } from "./types.js";

const agentSchemaVersion = 1;
const knownSections = ["Persona", "Instructions", "Boundaries", "Review Policy", "Output Format"];

export type AgentParseStatus = "valid" | "invalid";

export type AgentDocument = {
  filePath: string;
  relativePath: string;
  folderPath: string;
  hash: string;
  raw: string;
  frontmatter: Record<string, unknown>;
  sections: Array<{ name: string; content: string }>;
  definition: {
    schemaVersion: number;
    id: string;
    name: string;
    role: string;
    modelBackend: string;
    cliCommand: string | null;
    capabilities: string[];
    allowedTools: string[];
    maxParallel: number;
    enabled: boolean;
    instructionFiles: string[];
    persona: string;
    instructions: string;
    boundaries: string;
  };
};

export class AgentDefinitionConflictError extends Error {
  constructor() {
    super("Agent definition changed since it was loaded.");
    this.name = "AgentDefinitionConflictError";
  }
}

export function createAgentDefinition(projectPath: string, agent: AgentRecord): AgentDocument {
  const folderName = `${slugify(agent.name)}--${agent.id.slice(0, 8)}`;
  const relativePath = path.posix.join("agent", folderName, "agent.md");
  const filePath = resolveDefinitionPath(projectPath, relativePath);
  if (existsSync(filePath)) return readAgentDefinition(projectPath, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(path.dirname(filePath), "instructions"), { recursive: true, mode: 0o700 });
  const raw = renderAgentDocument({
    frontmatter: {
      schemaVersion: agentSchemaVersion,
      id: agent.id,
      name: agent.name,
      role: agent.role,
      modelBackend: agent.modelBackend,
      ...(agent.cliCommand ? { cliCommand: agent.cliCommand } : {}),
      capabilities: agent.capabilities,
      allowedTools: agent.allowedTools,
      maxParallel: agent.maxParallel,
      enabled: agent.enabled,
      instructionFiles: []
    },
    sections: [
      { name: "Persona", content: agent.persona },
      { name: "Instructions", content: "Perform the assigned work and report verification evidence." },
      { name: "Boundaries", content: agent.boundaries }
    ]
  });
  assertNoSecrets(raw);
  writeAtomic(filePath, raw);
  return readAgentDefinition(projectPath, relativePath);
}

export function readAgentDefinition(projectPath: string, relativePath: string): AgentDocument {
  const filePath = resolveDefinitionPath(projectPath, relativePath);
  if (!existsSync(filePath)) throw new Error(`Agent definition not found: ${relativePath}`);
  if (lstatSync(filePath).isSymbolicLink()) throw new Error("Agent definition cannot be a symlink.");
  const realFilePath = realpathSync(filePath);
  const realAgentRoot = realpathSync(path.join(projectHarnessPath(projectPath), "agent"));
  if (!isInside(realFilePath, realAgentRoot)) throw new Error("Agent definition symlink escapes .harness/agent.");
  const raw = readFileSync(filePath, "utf8");
  assertNoSecrets(raw);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("agent.md must start with YAML frontmatter.");
  const value = parse(match[1]);
  if (!isRecord(value)) throw new Error("Agent frontmatter must be an object.");
  const sections = parseSections(match[2]);
  const id = requiredString(value.id, "id");
  const name = requiredString(value.name, "name");
  const role = requiredString(value.role, "role");
  const modelBackend = requiredString(value.modelBackend, "modelBackend");
  const schemaVersion = Number(value.schemaVersion);
  if (schemaVersion !== agentSchemaVersion) throw new Error(`Unsupported agent schema version: ${value.schemaVersion}`);
  const instructionFiles = stringList(value.instructionFiles);
  const folderPath = path.dirname(filePath);
  for (const instructionFile of instructionFiles) validateInstructionPath(folderPath, instructionFile);
  const persona = sectionContent(sections, "Persona");
  const instructions = sectionContent(sections, "Instructions");
  const boundaries = sectionContent(sections, "Boundaries");
  if (!persona) throw new Error("Agent Persona section is required.");
  if (!instructions) throw new Error("Agent Instructions section is required.");
  return {
    filePath,
    relativePath: toProjectRelative(projectPath, filePath),
    folderPath,
    hash: hashContent(raw),
    raw,
    frontmatter: value,
    sections,
    definition: {
      schemaVersion,
      id,
      name,
      role,
      modelBackend,
      cliCommand: optionalString(value.cliCommand),
      capabilities: stringList(value.capabilities),
      allowedTools: stringList(value.allowedTools),
      maxParallel: Math.max(1, Number(value.maxParallel || 1)),
      enabled: value.enabled !== false,
      instructionFiles,
      persona,
      instructions,
      boundaries
    }
  };
}

export function updateAgentDefinition(
  projectPath: string,
  relativePath: string,
  patch: Partial<AgentRecord>,
  expectedHash?: string | null
) {
  const document = readAgentDefinition(projectPath, relativePath);
  if (expectedHash && document.hash !== expectedHash) throw new AgentDefinitionConflictError();
  const frontmatter = {
    ...document.frontmatter,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.role !== undefined ? { role: patch.role.trim() } : {}),
    ...(patch.modelBackend !== undefined ? { modelBackend: patch.modelBackend.trim() } : {}),
    ...(patch.cliCommand !== undefined ? { cliCommand: patch.cliCommand?.trim() || null } : {}),
    ...(patch.capabilities !== undefined ? { capabilities: normalizeStrings(patch.capabilities) } : {}),
    ...(patch.allowedTools !== undefined ? { allowedTools: normalizeStrings(patch.allowedTools) } : {}),
    ...(patch.maxParallel !== undefined ? { maxParallel: Math.max(1, Number(patch.maxParallel)) } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {})
  };
  const sections = document.sections.map((section) => {
    if (section.name === "Persona" && patch.persona !== undefined) return { ...section, content: patch.persona.trim() };
    if (section.name === "Boundaries" && patch.boundaries !== undefined) return { ...section, content: patch.boundaries.trim() };
    return section;
  });
  requiredString(frontmatter.name, "name");
  requiredString(frontmatter.role, "role");
  requiredString(frontmatter.modelBackend, "modelBackend");
  if (!sectionContent(sections, "Persona")) throw new Error("Agent Persona section is required.");
  if (!sectionContent(sections, "Instructions")) throw new Error("Agent Instructions section is required.");
  const raw = renderAgentDocument({ frontmatter, sections });
  assertNoSecrets(raw);
  writeAtomic(document.filePath, raw);
  return readAgentDefinition(projectPath, relativePath);
}

export function syncProjectAgentDefinitions(db: DatabaseSync, projectPath: string) {
  const rows = db.prepare("SELECT * FROM agents").all() as Array<Record<string, unknown>>;
  const results: Array<{ id: string; status: AgentParseStatus; error: string | null }> = [];
  for (const row of rows) {
    const id = String(row.id);
    let relativePath = row.definition_path ? String(row.definition_path) : "";
    try {
      if (!relativePath || !existsSync(resolveDefinitionPath(projectPath, relativePath))) {
        const created = createAgentDefinition(projectPath, legacyAgent(row));
        relativePath = created.relativePath;
      }
      const document = readAgentDefinition(projectPath, relativePath);
      if (document.definition.id !== id) throw new Error("Agent definition id does not match the database index.");
      if (!agentIndexMatches(row, document)) {
        db.prepare(`
          UPDATE agents SET name = ?, role = ?, persona = ?, model_backend = ?, cli_command = ?,
            capabilities = ?, allowed_tools = ?, boundaries = ?, max_parallel = ?, definition_path = ?,
            definition_hash = ?, definition_schema_version = ?, parse_status = ?, parse_error = ?, enabled = ?, updated_at = ?
          WHERE id = ?
        `).run(
          document.definition.name,
          document.definition.role,
          document.definition.persona,
          document.definition.modelBackend,
          document.definition.cliCommand,
          JSON.stringify(document.definition.capabilities),
          JSON.stringify(document.definition.allowedTools),
          document.definition.boundaries,
          document.definition.maxParallel,
          document.relativePath,
          document.hash,
          document.definition.schemaVersion,
          "valid",
          null,
          document.definition.enabled ? 1 : 0,
          new Date().toISOString(),
          id
        );
      }
      results.push({ id, status: "valid", error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (String(row.parse_status || "") !== "invalid" || String(row.parse_error || "") !== message) {
        db.prepare("UPDATE agents SET definition_path = ?, parse_status = ?, parse_error = ? WHERE id = ?")
          .run(relativePath || null, "invalid", message, id);
      }
      results.push({ id, status: "invalid", error: message });
    }
  }
  return results;
}

export function createAgentRunSnapshot(projectPath: string, relativePath: string) {
  const document = readAgentDefinition(projectPath, relativePath);
  const instructions = document.definition.instructionFiles.map((instructionFile) => {
    const filePath = validateInstructionPath(document.folderPath, instructionFile);
    const content = readFileSync(filePath, "utf8");
    assertNoSecrets(content);
    return `\n\n<!-- ${instructionFile} -->\n${content.trim()}\n`;
  }).join("");
  const content = `${document.raw.trim()}${instructions}`;
  assertNoSecrets(content);
  return { hash: document.hash, schemaVersion: document.definition.schemaVersion, content };
}

function renderAgentDocument(input: { frontmatter: Record<string, unknown>; sections: Array<{ name: string; content: string }> }) {
  const yaml = stringify(input.frontmatter, { lineWidth: 0 }).trim();
  const body = input.sections.map((section) => `# ${section.name}\n\n${section.content.trim()}`).join("\n\n");
  return `---\n${yaml}\n---\n\n${body}\n`;
}

function agentIndexMatches(row: Record<string, unknown>, document: AgentDocument) {
  const definition = document.definition;
  return String(row.name) === definition.name &&
    String(row.role) === definition.role &&
    String(row.persona) === definition.persona &&
    String(row.model_backend) === definition.modelBackend &&
    (row.cli_command ? String(row.cli_command) : null) === definition.cliCommand &&
    JSON.stringify(parseStoredList(row.capabilities)) === JSON.stringify(definition.capabilities) &&
    JSON.stringify(parseStoredList(row.allowed_tools)) === JSON.stringify(definition.allowedTools) &&
    String(row.boundaries || "") === definition.boundaries &&
    Number(row.max_parallel) === definition.maxParallel &&
    Number(row.enabled ?? 1) === (definition.enabled ? 1 : 0) &&
    String(row.definition_path || "") === document.relativePath &&
    String(row.definition_hash || "") === document.hash &&
    Number(row.definition_schema_version || 0) === definition.schemaVersion &&
    String(row.parse_status || "") === "valid" &&
    !row.parse_error;
}

function parseSections(body: string) {
  const sections: Array<{ name: string; content: string }> = [];
  const matches = [...body.matchAll(/^# ([^\r\n]+)\r?\n/gm)];
  for (const [index, match] of matches.entries()) {
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    sections.push({ name: match[1].trim(), content: body.slice(start, end).trim() });
  }
  for (const section of knownSections) {
    if (!sections.some((value) => value.name === section) && section === "Boundaries") sections.push({ name: section, content: "" });
  }
  return sections;
}

function validateInstructionPath(folderPath: string, instructionFile: string) {
  const normalized = instructionFile.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..") || !normalized.startsWith("instructions/")) {
    throw new Error(`Instruction file must stay inside the agent instructions folder: ${instructionFile}`);
  }
  const target = path.resolve(folderPath, normalized);
  if (!isInside(target, folderPath)) throw new Error(`Instruction file escapes the agent folder: ${instructionFile}`);
  if (!existsSync(target)) throw new Error(`Instruction file does not exist: ${instructionFile}`);
  if (lstatSync(target).isSymbolicLink()) throw new Error(`Instruction file cannot be a symlink: ${instructionFile}`);
  const realTarget = realpathSync(target);
  const realFolder = realpathSync(folderPath);
  if (!isInside(realTarget, realFolder)) throw new Error(`Instruction file symlink escapes the agent folder: ${instructionFile}`);
  return target;
}

function resolveDefinitionPath(projectPath: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..") || !normalized.startsWith("agent/")) {
    throw new Error("Agent definition path must stay inside .harness/agent.");
  }
  const harnessRoot = projectHarnessPath(projectPath);
  const target = path.resolve(harnessRoot, normalized);
  if (!isInside(target, path.join(harnessRoot, "agent"))) throw new Error("Agent definition path escapes .harness/agent.");
  return target;
}

function writeAtomic(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function legacyAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    persona: String(row.persona),
    modelBackend: String(row.model_backend),
    cliCommand: row.cli_command ? String(row.cli_command) : null,
    capabilities: parseStoredList(row.capabilities),
    allowedTools: parseStoredList(row.allowed_tools),
    boundaries: String(row.boundaries || ""),
    maxParallel: Number(row.max_parallel || 1),
    enabled: Number(row.enabled ?? 1) !== 0,
    status: String(row.status) as AgentRecord["status"],
    currentTaskId: row.current_task_id ? String(row.current_task_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    definitionPath: null,
    definitionHash: null,
    definitionSchemaVersion: null,
    parseStatus: "legacy",
    parseError: null
  };
}

function assertNoSecrets(content: string) {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{12,}\b/,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*(?::|=|\s)\s*["']?[A-Za-z0-9_./+-]{8,}/i,
    /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{10,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i
  ];
  if (patterns.some((pattern) => pattern.test(content))) throw new Error("Agent definition cannot contain credentials or secrets.");
}

function sectionContent(sections: Array<{ name: string; content: string }>, name: string) {
  return sections.find((section) => section.name === name)?.content.trim() || "";
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Agent ${field} is required.`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Agent list fields must be arrays.");
  return normalizeStrings(value);
}

function normalizeStrings(value: unknown[]) {
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function parseStoredList(value: unknown) {
  try {
    return normalizeStrings(JSON.parse(String(value || "[]")) as unknown[]);
  } catch {
    return [];
  }
}

function toProjectRelative(projectPath: string, filePath: string) {
  return path.relative(projectHarnessPath(projectPath), filePath).split(path.sep).join("/");
}

function isInside(target: string, directory: string) {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function slugify(value: string) {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "agent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
