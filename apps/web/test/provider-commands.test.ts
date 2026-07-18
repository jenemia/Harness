import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderCatalog } from "../src/api/contracts.js";
import {
  formatActiveModelLabel,
  parseProviderModelFromCommand,
  replaceProviderCommand,
  resolveConfiguredProviderCommand,
} from "../src/shared/providerCommands.js";
import { codexCommand, ollamaCommand, parseOllamaModelFromCommand } from "../src/features/settings/ModelSelectionPanel.js";

const catalog = {
  providerCommandKeys: {
    examples: [{
      modelBackend: "codex",
      label: "Codex",
      keys: ["node-darwin.codex", "darwin.codex", "codex"],
      commandExample: null,
    }],
  },
} as unknown as ProviderCatalog;

test("model selection builds a writable Codex command that reads prompt contents", () => {
  assert.equal(
    codexCommand("codex", { workspaceWrite: true, persistSession: false, useProjectRules: true }),
    'codex exec --sandbox workspace-write --ephemeral - < "$HARNESS_PROMPT_FILE"',
  );
});

test("Ollama model selection builds and restores the selected local model command", () => {
  const command = ollamaCommand("qwen3.5:9b");
  assert.equal(command, 'ollama run "qwen3.5:9b" < "$HARNESS_PROMPT_FILE"');
  assert.equal(parseOllamaModelFromCommand(command), "qwen3.5:9b");
});

test("provider command replacement removes stale higher-precedence keys", () => {
  const commands = {
    "node-darwin.codex": "codex exec --sandbox read-only prompt.md",
    "darwin.codex": "codex exec --sandbox read-only prompt.md",
    ollama: "ollama run qwen",
  };

  const next = replaceProviderCommand(
    commands,
    catalog,
    "codex",
    "codex exec --sandbox workspace-write prompt.md",
  );

  assert.deepEqual(next, {
    codex: "codex exec --sandbox workspace-write prompt.md",
    ollama: "ollama run qwen",
  });
  assert.equal(resolveConfiguredProviderCommand(next, catalog, "codex"), next.codex);
});

test("provider command resolution follows backend precedence", () => {
  assert.equal(resolveConfiguredProviderCommand({
    codex: "low precedence",
    "node-darwin.codex": "high precedence",
  }, catalog, "codex"), "high precedence");
});

test("active model label includes the selected Ollama model", () => {
  const ollamaCatalog = {
    ...catalog,
    llmProviders: [{ id: "ollama", label: "Ollama" }],
  } as unknown as ProviderCatalog;
  const command = 'ollama run "qwen3.5:9b" < "$HARNESS_PROMPT_FILE"';

  assert.equal(parseProviderModelFromCommand("ollama", command), "qwen3.5:9b");
  assert.equal(formatActiveModelLabel({
    defaultModelBackend: "ollama",
    providerCommands: { ollama: command },
  }, ollamaCatalog), "Ollama · qwen3.5:9b");
});

test("active model label includes a Codex command model override", () => {
  const codexCatalog = {
    ...catalog,
    llmProviders: [{ id: "codex", label: "Codex CLI" }],
  } as unknown as ProviderCatalog;
  const command = "codex exec -m gpt-5.4 -";

  assert.equal(parseProviderModelFromCommand("codex", command), "gpt-5.4");
  assert.equal(formatActiveModelLabel({
    defaultModelBackend: "codex",
    providerCommands: { codex: command },
  }, codexCatalog), "Codex CLI · gpt-5.4");
});
