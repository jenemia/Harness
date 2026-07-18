import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoCredentialMaterial,
  containsCredentialMaterial,
  redactCredentialMaterial
} from "../src/credential-security.js";
import { diagnoseCliAuthentication, ollamaCommand, parseOllamaListOutput, parseOllamaModelFromCommand } from "../src/providers.js";

test("credential material is rejected or redacted while environment references remain allowed", () => {
  assert.equal(containsCredentialMaterial("codex exec $HARNESS_PROMPT_FILE"), false);
  assert.equal(containsCredentialMaterial("tool --token $PROVIDER_TOKEN"), false);
  assert.equal(containsCredentialMaterial("api_key=supersecretvalue"), true);
  assert.throws(() => assertNoCredentialMaterial({ codex: "tool --token supersecretvalue" }, "Provider commands"), /existing login session/);
  assert.equal(redactCredentialMaterial("Authorization: Bearer abcdefghijklmnop"), "Authorization: [REDACTED]");
  assert.equal(redactCredentialMaterial("api_key=supersecretvalue"), "api_key=[REDACTED]");
  const diagnostic = diagnoseCliAuthentication({
    strategy: "cli-session",
    executable: "harness-definitely-missing-cli",
    versionArgs: ["--version"],
    statusArgs: ["status"],
    loginCommand: "harness-definitely-missing-cli login"
  });
  assert.equal(diagnostic.installed, false);
  assert.match(diagnostic.message, /not installed/);
});

test("Ollama diagnostics parse installed models and build a prompt-file command", () => {
  const models = parseOllamaListOutput([
    "NAME          ID              SIZE      MODIFIED",
    "qwen3.5:9b    6488c96fa5fa    6.6 GB    4 months ago",
    "llama3.2:3b   a80c4f17acd5    2.0 GB    2 days ago",
  ].join("\n"));
  assert.deepEqual(models.map((model) => [model.name, model.size]), [["qwen3.5:9b", "6.6 GB"], ["llama3.2:3b", "2.0 GB"]]);
  const command = ollamaCommand("qwen3.5:9b");
  assert.equal(command, `ollama run 'qwen3.5:9b' < "$HARNESS_PROMPT_FILE"`);
  assert.equal(parseOllamaModelFromCommand(command), "qwen3.5:9b");
});
