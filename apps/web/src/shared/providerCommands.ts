import type { ProjectSettings, ProviderCatalog } from "../api/contracts";
import { parseStringMapText } from "./formParsing";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatProviderCommandResolution(
  metadata: Record<string, unknown>,
) {
  const commandKey =
    typeof metadata.providerCommandKey === "string"
      ? metadata.providerCommandKey
      : "";
  const commandSource =
    typeof metadata.providerCommandSource === "string"
      ? metadata.providerCommandSource
      : "";
  const platformProvider =
    typeof metadata.platformProviderId === "string"
      ? metadata.platformProviderId
      : "";
  if (!commandKey && !commandSource && !platformProvider) {
    return "";
  }
  return [commandKey || commandSource, platformProvider]
    .filter(Boolean)
    .join(" on ");
}

export function formatProviderCommandPlaceholder(
  providerCatalog: ProviderCatalog | null,
  modelBackend: string,
) {
  const example =
    getProviderCommandExample(providerCatalog, modelBackend) ||
    providerCatalog?.providerCommandKeys.examples[0];
  if (!example) {
    return '{\n  "codex": "codex exec \\"$HARNESS_PROMPT_FILE\\""\n}';
  }
  const command =
    example.commandExample ||
    `run-${example.modelBackend} "$HARNESS_PROMPT_FILE"`;
  return JSON.stringify(
    {
      [example.keys[0]]: command,
      [example.keys[example.keys.length - 1]]: command,
    },
    null,
    2,
  );
}

export function getProviderCommandExample(
  providerCatalog: ProviderCatalog | null,
  modelBackend: string,
) {
  return (
    providerCatalog?.providerCommandKeys.examples.find(
      (item) => item.modelBackend === modelBackend,
    ) || null
  );
}

export function resolveConfiguredProviderCommand(
  commands: Record<string, string>,
  providerCatalog: ProviderCatalog | null,
  modelBackend: string,
) {
  const keys = getProviderCommandExample(providerCatalog, modelBackend)?.keys || [modelBackend];
  const key = keys.find((candidate) => commands[candidate]?.trim());
  return key ? commands[key] : undefined;
}

function unquote(value: string) {
  const first = value[0];
  return (first === '"' || first === "'") && value.at(-1) === first
    ? value.slice(1, -1)
    : value;
}

export function parseProviderModelFromCommand(
  modelBackend: string,
  command: string | undefined,
) {
  if (!command) return "";
  if (modelBackend === "ollama") {
    const match = command.match(/(?:^|\s)ollama\s+run\s+("[^"]+"|'[^']+'|[^\s<]+)/);
    return match ? unquote(match[1]) : "";
  }
  if (modelBackend.startsWith("codex")) {
    const match = command.match(/(?:^|\s)(?:--model|-m)\s+("[^"]+"|'[^']+'|[^\s<]+)/);
    return match ? unquote(match[1]) : "";
  }
  return "";
}

export function formatActiveModelLabel(
  settings: Pick<ProjectSettings, "defaultModelBackend" | "providerCommands">,
  providerCatalog: ProviderCatalog | null,
) {
  const backend = settings.defaultModelBackend;
  const providerLabel =
    providerCatalog?.llmProviders?.find((provider) => provider.id === backend)?.label || backend;
  const command = resolveConfiguredProviderCommand(
    settings.providerCommands,
    providerCatalog,
    backend,
  );
  const model = parseProviderModelFromCommand(backend, command);
  return model && !providerLabel.toLowerCase().includes(model.toLowerCase())
    ? `${providerLabel} · ${model}`
    : providerLabel;
}

export function replaceProviderCommand(
  commands: Record<string, string>,
  providerCatalog: ProviderCatalog | null,
  modelBackend: string,
  command: string,
) {
  const next = { ...commands };
  const keys = getProviderCommandExample(providerCatalog, modelBackend)?.keys || [modelBackend];
  for (const key of keys) delete next[key];
  next[modelBackend] = command;
  return next;
}

export function mergeProviderCommandText(
  value: string,
  providerCatalog: ProviderCatalog | null,
  modelBackend: string,
  keyIndex: number,
) {
  const example = getProviderCommandExample(providerCatalog, modelBackend);
  if (!example) {
    return value;
  }
  const parsed = parseStringMapText(value, "Provider commands");
  const key = example.keys[Math.min(keyIndex, example.keys.length - 1)];
  return JSON.stringify(
    {
      ...parsed,
      [key]:
        parsed[key] ||
        example.commandExample ||
        `run-${example.modelBackend} "$HARNESS_PROMPT_FILE"`,
    },
    null,
    2,
  );
}
