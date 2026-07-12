import assert from "node:assert/strict";
import test from "node:test";
import { buildLineDiff, parseAgentMarkdownDraft, updateAgentMarkdownDraft } from "../src/features/agents/agentMarkdownDraft.js";
import { connectedAgentModels } from "../src/features/agents/agentModelOptions.js";
import type { Overview, ProviderCatalog } from "../src/api/contracts.js";

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

test("invalid raw Markdown reports a structured parse location instead of mutating the form", () => {
  assert.throws(() => parseAgentMarkdownDraft("not frontmatter"), /frontmatter/);
  assert.throws(() => parseAgentMarkdownDraft("---\nname: [\n---\n"));
});
