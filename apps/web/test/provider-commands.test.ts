import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderCatalog } from "../src/api/contracts.js";
import { replaceProviderCommand, resolveConfiguredProviderCommand } from "../src/shared/providerCommands.js";
import { codexCommand } from "../src/features/settings/ModelSelectionPanel.js";

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
