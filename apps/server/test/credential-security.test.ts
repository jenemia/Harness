import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoCredentialMaterial,
  containsCredentialMaterial,
  redactCredentialMaterial
} from "../src/credential-security.js";
import { diagnoseCliAuthentication } from "../src/providers.js";

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
