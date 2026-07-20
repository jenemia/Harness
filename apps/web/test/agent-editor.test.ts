import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLineDiff, parseAgentMarkdownDraft, updateAgentMarkdownDraft } from "../src/features/agents/agentMarkdownDraft.js";
import { connectedAgentModelChoices, connectedAgentModels, selectedAgentModelChoice } from "../src/features/agents/agentModelOptions.js";
import type { Overview, ProviderCatalog } from "../src/api/contracts.js";
import { messages } from "../src/i18n/messages.js";
import { defaultLocale, resolveSupportedLocale } from "../src/i18n/provider.js";

const raw = `---
schemaVersion: 1
id: agent-1
name: Review Agent
role: reviewer
modelBackend: mock
capabilities: [review]
allowedTools: [diff]
maxParallel: 1
enabled: true
instructionFiles: []
customFlag: preserve-me
---

# Persona

Review carefully.

# Instructions

Report evidence.

# Boundaries

Do not edit source.

# Custom Notes

Keep this section.
`;

test("structured and raw agent editors share one lossless Markdown draft", () => {
  const parsed = parseAgentMarkdownDraft(raw);
  assert.equal(parsed.name, "Review Agent");
  assert.equal(parsed.persona, "Review carefully.");

  const changed = updateAgentMarkdownDraft(raw, {
    name: "Security Reviewer",
    persona: "Review authentication carefully.",
    capabilities: ["review", "security"],
    enabled: false
  });
  const reparsed = parseAgentMarkdownDraft(changed);
  assert.equal(reparsed.name, "Security Reviewer");
  assert.equal(reparsed.persona, "Review authentication carefully.");
  assert.deepEqual(reparsed.capabilities, ["review", "security"]);
  assert.equal(reparsed.enabled, false);
  assert.match(changed, /customFlag: preserve-me/);
  assert.match(changed, /# Custom Notes[\s\S]*Keep this section/);

  const diff = buildLineDiff(raw, changed);
  assert.ok(diff.some((line) => line.kind === "remove" && line.text.includes("Review Agent")));
  assert.ok(diff.some((line) => line.kind === "add" && line.text.includes("Security Reviewer")));
});

test("persona and default instructions update without dropping custom Markdown", () => {
  const changed = updateAgentMarkdownDraft(raw, {
    persona: "Own the release quality.",
    instructions: "Run focused tests and report evidence.",
    modelBackend: "cursor-cli",
  });
  const reparsed = parseAgentMarkdownDraft(changed);
  assert.equal(reparsed.persona, "Own the release quality.");
  assert.equal(reparsed.instructions, "Run focused tests and report evidence.");
  assert.equal(reparsed.modelBackend, "cursor-cli");
  assert.match(changed, /# Custom Notes[\s\S]*Keep this section/);
  assert.match(changed, /customFlag: preserve-me/);
});

test("connected model options include authenticated or configured providers only", () => {
  const catalog = {
    llmProviders: [
      { id: "authenticated", label: "Authenticated", authenticationStatus: { authenticated: true } },
      { id: "configured", label: "Configured", authenticationStatus: null },
      { id: "defaulted", label: "Defaulted", authenticationStatus: null, defaultCommand: "run" },
      { id: "missing", label: "Missing", authenticationStatus: { authenticated: false } },
    ],
    providerCommandKeys: { examples: [
      { modelBackend: "configured", keys: ["configured.command"] },
      { modelBackend: "missing", keys: ["missing.command"] },
    ] },
  } as unknown as ProviderCatalog;
  const settings = { providerCommands: { "configured.command": "configured run" } } as unknown as Overview["settings"];
  assert.deepEqual(connectedAgentModels(catalog, settings), [
    { id: "authenticated", label: "Authenticated" },
    { id: "configured", label: "Configured" },
    { id: "defaulted", label: "Defaulted" },
  ]);
});

test("agent model choices expand installed Ollama models and retain Codex variants", () => {
  const catalog = {
    llmProviders: [
      { id: "codex-5.6-terra", label: "Codex · GPT-5.6 Terra", authenticationStatus: { authenticated: true } },
      { id: "ollama", label: "Ollama", authenticationStatus: { authenticated: true }, ollamaStatus: { models: [{ name: "qwen3:8b" }] } },
    ],
    providerCommandKeys: { examples: [] },
  } as unknown as ProviderCatalog;
  const settings = { providerCommands: {} } as unknown as Overview["settings"];
  const choices = connectedAgentModelChoices(catalog, settings);
  assert.deepEqual(choices, [
    { id: "codex-5.6-terra", label: "Codex · GPT-5.6 Terra", modelBackend: "codex-5.6-terra", cliCommand: null },
    { id: "ollama:qwen3:8b", label: "Ollama · qwen3:8b", modelBackend: "ollama", cliCommand: "ollama run \"qwen3:8b\" < \"$HARNESS_PROMPT_FILE\"" },
  ]);
  assert.equal(selectedAgentModelChoice("ollama", choices[1].cliCommand, choices)?.id, "ollama:qwen3:8b");
});

test("invalid raw Markdown reports a structured parse location instead of mutating the form", () => {
  assert.throws(() => parseAgentMarkdownDraft("not frontmatter"), /frontmatter/);
  assert.throws(() => parseAgentMarkdownDraft("---\nname: [\n---\n"));
});

test("Korean is the default locale and agent management copy is localized", () => {
  assert.equal(defaultLocale, "ko");
  assert.equal(resolveSupportedLocale(["fr-FR"]), "ko");
  assert.equal(messages.ko["agents.assignedTasks"], "배정된 일감");
  assert.equal(messages.ko["agents.archiveAgent"], "에이전트 보관");
  assert.equal(messages.ko["agents.validationValid"], "유효함");

  const editor = readFileSync(new URL("../src/features/agents/AgentMarkdownEditor.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/features/agents/AgentPanel.tsx", import.meta.url), "utf8");
  assert.match(editor, /useI18n/);
  assert.doesNotMatch(editor, />Assigned tasks</);
  assert.doesNotMatch(editor, />Advanced settings</);
  assert.doesNotMatch(editor, />Archive agent</);
  assert.doesNotMatch(panel, /placeholder="Capabilities"/);

  const languageProvider = readFileSync(new URL("../src/i18n/provider.tsx", import.meta.url), "utf8");
  assert.match(languageProvider, /settingsService\.updateInterfaceLocale\(locale\)/);
});
