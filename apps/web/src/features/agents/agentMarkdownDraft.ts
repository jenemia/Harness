import { parse, stringify } from "yaml";

export type ParsedAgentMarkdownDraft = {
  frontmatter: Record<string, unknown>;
  sections: Array<{ name: string; content: string }>;
  name: string;
  role: string;
  modelBackend: string;
  cliCommand: string;
  capabilities: string[];
  allowedTools: string[];
  maxParallel: number;
  enabled: boolean;
  persona: string;
  instructions: string;
  boundaries: string;
};

export function parseAgentMarkdownDraft(raw: string): ParsedAgentMarkdownDraft {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("agent.md must start with YAML frontmatter.");
  const frontmatter = parse(match[1]);
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) throw new Error("Agent frontmatter must be an object.");
  const value = frontmatter as Record<string, unknown>;
  const sections = parseSections(match[2]);
  return {
    frontmatter: value,
    sections,
    name: String(value.name || ""),
    role: String(value.role || "worker"),
    modelBackend: String(value.modelBackend || "mock"),
    cliCommand: typeof value.cliCommand === "string" ? value.cliCommand : "",
    capabilities: stringArray(value.capabilities),
    allowedTools: stringArray(value.allowedTools),
    maxParallel: Math.max(1, Number(value.maxParallel || 1)),
    enabled: value.enabled !== false,
    persona: sectionValue(sections, "Persona"),
    instructions: sectionValue(sections, "Instructions"),
    boundaries: sectionValue(sections, "Boundaries"),
  };
}

export function updateAgentMarkdownDraft(raw: string, patch: Partial<ParsedAgentMarkdownDraft>) {
  const parsed = parseAgentMarkdownDraft(raw);
  const frontmatter = {
    ...parsed.frontmatter,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.modelBackend !== undefined ? { modelBackend: patch.modelBackend } : {}),
    ...(patch.cliCommand !== undefined ? { cliCommand: patch.cliCommand || null } : {}),
    ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
    ...(patch.allowedTools !== undefined ? { allowedTools: patch.allowedTools } : {}),
    ...(patch.maxParallel !== undefined ? { maxParallel: patch.maxParallel } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  };
  const sections = parsed.sections.map((section) => {
    if (section.name === "Persona" && patch.persona !== undefined) return { ...section, content: patch.persona };
    if (section.name === "Instructions" && patch.instructions !== undefined) return { ...section, content: patch.instructions };
    if (section.name === "Boundaries" && patch.boundaries !== undefined) return { ...section, content: patch.boundaries };
    return section;
  });
  if (patch.persona !== undefined && !sections.some((section) => section.name === "Persona")) {
    sections.push({ name: "Persona", content: patch.persona });
  }
  if (patch.instructions !== undefined && !sections.some((section) => section.name === "Instructions")) {
    sections.push({ name: "Instructions", content: patch.instructions });
  }
  const yaml = stringify(frontmatter, { lineWidth: 0 }).trim();
  const body = sections.map((section) => `# ${section.name}\n\n${section.content.trim()}`).join("\n\n");
  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function buildLineDiff(before: string, after: string) {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length * right.length > 160_000) {
    return [{ kind: "remove" as const, text: `${left.length} original lines` }, { kind: "add" as const, text: `${right.length} changed lines` }];
  }
  const matrix = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  const result: Array<{ kind: "same" | "add" | "remove"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "same", text: left[i] }); i += 1; j += 1;
    } else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      result.push({ kind: "add", text: right[j] }); j += 1;
    } else {
      result.push({ kind: "remove", text: left[i] }); i += 1;
    }
  }
  return result;
}

function parseSections(body: string) {
  const matches = [...body.matchAll(/^# ([^\r\n]+)\r?\n/gm)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return { name: match[1].trim(), content: body.slice(start, end).trim() };
  });
}

function sectionValue(sections: Array<{ name: string; content: string }>, name: string) {
  return sections.find((section) => section.name === name)?.content || "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
