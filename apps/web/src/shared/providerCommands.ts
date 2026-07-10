import type { ProviderCatalog } from "../api/contracts";
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
