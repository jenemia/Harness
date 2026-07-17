import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { projectHarnessPath } from "./project-store.js";
import type { AgentRecord, ReviewSchedule } from "./types.js";
import { assertNoCredentialMaterial } from "./credential-security.js";

const agentSchemaVersion = 2;
const knownSections = ["Persona", "Instructions", "Boundaries", "Review Policy", "Output Format"];

export type AgentParseStatus = "valid" | "invalid";

export type AgentInstructionDocument = {
  path: string;
  filePath: string;
  content: string;
  hash: string;
};

export type AgentDefinitionSource = {
  filePath: string;
  relativePath: string;
  folderPath: string;
  hash: string;
  raw: string;
};

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
    reviewSchedule: ReviewSchedule | null;
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
      ...(agent.reviewSchedule ? { reviewSchedule: agent.reviewSchedule } : {}),
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
  const source = readAgentDefinitionSource(projectPath, relativePath);
  return parseAgentDocument(projectPath, relativePath, source.filePath, source.raw);
}

export function readAgentDefinitionSource(projectPath: string, relativePath: string): AgentDefinitionSource {
  const filePath = resolveDefinitionPath(projectPath, relativePath);
  if (!existsSync(filePath)) throw new Error(`Agent definition not found: ${relativePath}`);
  if (lstatSync(filePath).isSymbolicLink()) throw new Error("Agent definition cannot be a symlink.");
  const realFilePath = realpathSync(filePath);
  const realAgentRoot = realpathSync(path.join(projectHarnessPath(projectPath), "agent"));
  if (!isInside(realFilePath, realAgentRoot)) throw new Error("Agent definition symlink escapes .harness/agent.");
  const raw = readFileSync(filePath, "utf8");
  return { filePath, relativePath: toProjectRelative(projectPath, filePath), folderPath: path.dirname(filePath), hash: hashContent(raw), raw };
}

export function validateAgentDefinitionRaw(projectPath: string, relativePath: string, raw: string) {
  const filePath = resolveDefinitionPath(projectPath, relativePath);
  return parseAgentDocument(projectPath, relativePath, filePath, raw);
}

function parseAgentDocument(projectPath: string, relativePath: string, filePath: string, raw: string): AgentDocument {
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
  if (schemaVersion !== 1 && schemaVersion !== agentSchemaVersion) throw new Error(`Unsupported agent schema version: ${value.schemaVersion}`);
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
      reviewSchedule: parseReviewSchedule(value.reviewSchedule, role),
      instructionFiles,
      persona,
      instructions,
      boundaries
    }
  };
}

export function writeAgentDefinitionRaw(
  projectPath: string,
  relativePath: string,
  raw: string,
  expectedHash: string,
  expectedAgentId?: string
) {
  const current = readAgentDefinitionSource(projectPath, relativePath);
  if (!expectedHash || current.hash !== expectedHash) throw new AgentDefinitionConflictError();
  const candidate = validateAgentDefinitionRaw(projectPath, relativePath, raw);
  if (expectedAgentId && candidate.definition.id !== expectedAgentId) throw new Error("Agent definition id cannot be changed.");
  writeAtomic(current.filePath, raw.endsWith("\n") ? raw : `${raw}\n`);
  return readAgentDefinition(projectPath, relativePath);
}

export function listAgentInstructions(projectPath: string, relativePath: string) {
  const document = readAgentDefinition(projectPath, relativePath);
  return document.definition.instructionFiles.map((instructionPath) => readInstruction(document.folderPath, instructionPath));
}

export function saveAgentInstruction(
  projectPath: string,
  relativePath: string,
  input: {
    instructionPath?: string | null;
    name?: string | null;
    content: string;
    expectedDefinitionHash: string;
    expectedInstructionHash?: string | null;
  }
) {
  const document = requireDefinitionHash(projectPath, relativePath, input.expectedDefinitionHash);
  assertNoSecrets(input.content);
  const creating = !input.instructionPath;
  const instructionPath = creating
    ? normalizeInstructionName(input.name || "instruction")
    : requiredInstructionReference(document, input.instructionPath as string);
  const filePath = path.resolve(document.folderPath, instructionPath);
  if (creating && existsSync(filePath)) throw new Error(`Instruction file already exists: ${instructionPath}`);
  if (!creating) {
    const existing = readInstruction(document.folderPath, instructionPath);
    if (input.expectedInstructionHash && existing.hash !== input.expectedInstructionHash) throw new AgentDefinitionConflictError();
  }
  writeAtomic(filePath, input.content.endsWith("\n") ? input.content : `${input.content}\n`);
  if (creating) {
    try {
      writeInstructionOrder(document, [...document.definition.instructionFiles, instructionPath]);
    } catch (error) {
      rmSync(filePath, { force: true });
      throw error;
    }
  }
  return agentDocumentBundle(projectPath, relativePath);
}

export function renameAgentInstruction(
  projectPath: string,
  relativePath: string,
  input: { instructionPath: string; name: string; expectedDefinitionHash: string; expectedInstructionHash: string }
) {
  const document = requireDefinitionHash(projectPath, relativePath, input.expectedDefinitionHash);
  const instructionPath = requiredInstructionReference(document, input.instructionPath);
  const existing = readInstruction(document.folderPath, instructionPath);
  if (existing.hash !== input.expectedInstructionHash) throw new AgentDefinitionConflictError();
  const nextPath = normalizeInstructionName(input.name);
  if (nextPath === instructionPath) return agentDocumentBundle(projectPath, relativePath);
  const nextFilePath = path.resolve(document.folderPath, nextPath);
  if (existsSync(nextFilePath)) throw new Error(`Instruction file already exists: ${nextPath}`);
  renameSync(existing.filePath, nextFilePath);
  try {
    writeInstructionOrder(document, document.definition.instructionFiles.map((value) => value === instructionPath ? nextPath : value));
  } catch (error) {
    renameSync(nextFilePath, existing.filePath);
    throw error;
  }
  return agentDocumentBundle(projectPath, relativePath);
}

export function removeAgentInstruction(
  projectPath: string,
  relativePath: string,
  input: { instructionPath: string; expectedDefinitionHash: string; expectedInstructionHash: string }
) {
  const document = requireDefinitionHash(projectPath, relativePath, input.expectedDefinitionHash);
  const instructionPath = requiredInstructionReference(document, input.instructionPath);
  const existing = readInstruction(document.folderPath, instructionPath);
  if (existing.hash !== input.expectedInstructionHash) throw new AgentDefinitionConflictError();
  const temporaryPath = `${existing.filePath}.${process.pid}.${randomUUID()}.remove`;
  renameSync(existing.filePath, temporaryPath);
  try {
    writeInstructionOrder(document, document.definition.instructionFiles.filter((value) => value !== instructionPath));
    unlinkSync(temporaryPath);
  } catch (error) {
    if (existsSync(temporaryPath)) renameSync(temporaryPath, existing.filePath);
    throw error;
  }
  return agentDocumentBundle(projectPath, relativePath);
}

export function reorderAgentInstructions(
  projectPath: string,
  relativePath: string,
  input: { instructionPaths: string[]; expectedDefinitionHash: string }
) {
  const document = requireDefinitionHash(projectPath, relativePath, input.expectedDefinitionHash);
  const normalized = input.instructionPaths.map((value) => requiredInstructionReference(document, value));
  if (new Set(normalized).size !== normalized.length ||
      [...normalized].sort().join("\n") !== [...document.definition.instructionFiles].sort().join("\n")) {
    throw new Error("Instruction order must contain each referenced instruction exactly once.");
  }
  writeInstructionOrder(document, normalized);
  return agentDocumentBundle(projectPath, relativePath);
}

export function cloneAgentDefinition(
  projectPath: string,
  sourceRelativePath: string,
  agent: AgentRecord
) {
  const source = readAgentDefinition(projectPath, sourceRelativePath);
  const folderName = `${slugify(agent.name)}--${agent.id.slice(0, 8)}`;
  const relativePath = path.posix.join("agent", folderName, "agent.md");
  const filePath = resolveDefinitionPath(projectPath, relativePath);
  if (existsSync(path.dirname(filePath))) throw new Error("Cloned agent folder already exists.");
  mkdirSync(path.join(path.dirname(filePath), "instructions"), { recursive: true, mode: 0o700 });
  try {
    for (const instruction of listAgentInstructions(projectPath, sourceRelativePath)) {
      writeAtomic(path.resolve(path.dirname(filePath), instruction.path), instruction.content);
    }
    const raw = renderAgentDocument({
      frontmatter: {
        ...source.frontmatter,
        id: agent.id,
        name: agent.name,
        enabled: agent.enabled
      },
      sections: source.sections
    });
    writeAtomic(filePath, raw);
    return readAgentDefinition(projectPath, relativePath);
  } catch (error) {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
    throw error;
  }
}

export function archiveAgentDefinition(projectPath: string, relativePath: string, expectedHash: string) {
  const document = readAgentDefinitionSource(projectPath, relativePath);
  if (!expectedHash || document.hash !== expectedHash) throw new AgentDefinitionConflictError();
  const archiveRoot = path.join(projectHarnessPath(projectPath), "agent", ".archive");
  mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const target = path.join(archiveRoot, path.basename(document.folderPath));
  if (existsSync(target)) throw new Error("Agent archive folder already exists.");
  renameSync(document.folderPath, target);
  return {
    archivePath: toProjectRelative(projectPath, target),
    folderPath: target
  };
}

export function restoreArchivedAgentDefinition(projectPath: string, archivePath: string, relativePath: string) {
  const archiveTarget = path.resolve(projectHarnessPath(projectPath), archivePath);
  const archiveRoot = path.resolve(projectHarnessPath(projectPath), "agent", ".archive");
  if (!isInside(archiveTarget, archiveRoot)) throw new Error("Agent archive path escapes .harness/agent/.archive.");
  const definitionTarget = resolveDefinitionPath(projectPath, relativePath);
  renameSync(archiveTarget, path.dirname(definitionTarget));
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
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.reviewSchedule !== undefined ? { reviewSchedule: patch.reviewSchedule } : {})
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
  const rows = db.prepare("SELECT * FROM agents WHERE archived_at IS NULL").all() as Array<Record<string, unknown>>;
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
            capabilities = ?, allowed_tools = ?, boundaries = ?, max_parallel = ?, review_schedule = ?, definition_path = ?,
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
          document.definition.reviewSchedule ? JSON.stringify(document.definition.reviewSchedule) : null,
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
    JSON.stringify(parseStoredReviewSchedule(row.review_schedule)) === JSON.stringify(definition.reviewSchedule) &&
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

function readInstruction(folderPath: string, instructionPath: string): AgentInstructionDocument {
  const filePath = validateInstructionPath(folderPath, instructionPath);
  const content = readFileSync(filePath, "utf8");
  assertNoSecrets(content);
  return { path: instructionPath, filePath, content, hash: hashContent(content) };
}

function requireDefinitionHash(projectPath: string, relativePath: string, expectedHash: string) {
  const document = readAgentDefinition(projectPath, relativePath);
  if (!expectedHash || document.hash !== expectedHash) throw new AgentDefinitionConflictError();
  return document;
}

function requiredInstructionReference(document: AgentDocument, instructionPath: string) {
  if (!document.definition.instructionFiles.includes(instructionPath)) {
    throw new Error(`Instruction file is not referenced by agent.md: ${instructionPath}`);
  }
  validateInstructionPath(document.folderPath, instructionPath);
  return instructionPath;
}

function normalizeInstructionName(name: string) {
  const stem = name.trim().replace(/\.md$/i, "").replace(/\s+/g, "-");
  if (!stem || stem === "." || stem === ".." || /[\\/\0\r\n]/.test(stem)) {
    throw new Error("Instruction name must be a safe Markdown filename.");
  }
  return `instructions/${stem}.md`;
}

function writeInstructionOrder(document: AgentDocument, instructionFiles: string[]) {
  for (const instructionFile of instructionFiles) validateInstructionPath(document.folderPath, instructionFile);
  const raw = renderAgentDocument({
    frontmatter: { ...document.frontmatter, instructionFiles },
    sections: document.sections
  });
  assertNoSecrets(raw);
  writeAtomic(document.filePath, raw);
}

function agentDocumentBundle(projectPath: string, relativePath: string) {
  return {
    document: readAgentDefinition(projectPath, relativePath),
    instructions: listAgentInstructions(projectPath, relativePath)
  };
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
    reviewSchedule: parseStoredReviewSchedule(row.review_schedule),
    enabled: Number(row.enabled ?? 1) !== 0,
    status: String(row.status) as AgentRecord["status"],
    currentTaskId: row.current_task_id ? String(row.current_task_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    definitionPath: null,
    definitionHash: null,
    definitionSchemaVersion: null,
    parseStatus: "legacy",
    parseError: null,
    archivedAt: null,
    archivePath: null
  };
}

function assertNoSecrets(content: string) {
  try {
    assertNoCredentialMaterial(content, "Agent definition");
  } catch {
    throw new Error("Agent definition cannot contain credentials or secrets.");
  }
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

export function parseReviewSchedule(value: unknown, role = "code-reviewer"): ReviewSchedule | null {
  if (value === undefined || value === null) return role === "code-reviewer" ? defaultReviewSchedule() : null;
  if (!isRecord(value)) throw new Error("reviewSchedule must be an object.");
  const trigger = String(value.trigger || "on-commit");
  if (!(["on-commit", "interval", "daily"] as string[]).includes(trigger)) throw new Error("reviewSchedule.trigger is invalid.");
  const intervalMinutes = value.intervalMinutes === undefined || value.intervalMinutes === null ? null : Number(value.intervalMinutes);
  const dailyAt = typeof value.dailyAt === "string" && value.dailyAt.trim() ? value.dailyAt.trim() : null;
  const timezone = typeof value.timezone === "string" && value.timezone.trim() ? value.timezone.trim() : null;
  if (trigger === "interval" && (!Number.isInteger(intervalMinutes) || Number(intervalMinutes) < 15)) {
    throw new Error("Interval review schedules require intervalMinutes of at least 15.");
  }
  if (trigger === "daily") {
    if (!dailyAt || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyAt)) throw new Error("Daily review schedules require dailyAt in HH:mm format.");
    if (!timezone || !isIanaTimezone(timezone)) throw new Error("Daily review schedules require a valid IANA timezone.");
  }
  return {
    enabled: value.enabled !== false,
    trigger: trigger as ReviewSchedule["trigger"],
    intervalMinutes: trigger === "interval" ? intervalMinutes : null,
    dailyAt: trigger === "daily" ? dailyAt : null,
    timezone: trigger === "daily" ? timezone : null
  };
}

export function defaultReviewSchedule(): ReviewSchedule {
  return { enabled: true, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null };
}

function parseStoredReviewSchedule(value: unknown) {
  if (!value) return null;
  try { return parseReviewSchedule(JSON.parse(String(value))); } catch { return null; }
}

function isIanaTimezone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
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
