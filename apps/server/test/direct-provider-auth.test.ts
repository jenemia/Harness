import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeviceAuthorizationRequest,
  createPkceAuthorizationRequest,
  DirectProviderAuthManager,
  validateDirectProviderOAuthDefinition,
  type DirectProviderOAuthDefinition
} from "../src/direct-provider-auth.js";
import {
  globalHarnessDir,
  listOAuthAccountReferences,
  listProjectOAuthAccountLinks
} from "../src/db.js";
import { createOsCredentialStore, type CredentialCommandRunner, type OsCredentialStore } from "../src/os-credential-store.js";
import { listRuntimeProviders } from "../src/runtime.js";
import { registerProjectService } from "../src/services.js";

const pkceDefinition: DirectProviderOAuthDefinition = {
  providerId: "example-direct",
  label: "Example Direct Provider",
  strategy: "oauth2-pkce",
  authorizationEndpoint: "https://accounts.example.test/oauth/authorize",
  tokenEndpoint: "https://accounts.example.test/oauth/token",
  clientId: "harness-public-client",
  scopes: ["models:run", "profile:read"],
  redirectUris: ["http://127.0.0.1:43821/oauth/callback"]
};

test("direct provider OAuth definitions enforce PKCE and device public-client contracts", () => {
  const request = createPkceAuthorizationRequest(pkceDefinition, pkceDefinition.redirectUris[0]);
  const url = new URL(request.authorizationUrl);
  assert.ok(request.verifier.length >= 43 && request.verifier.length <= 128);
  assert.equal(request.challenge, createHash("sha256").update(request.verifier, "ascii").digest("base64url"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), request.challenge);
  assert.equal(url.searchParams.get("state"), request.state);
  assert.equal(url.searchParams.get("client_secret"), null);

  const deviceDefinition: DirectProviderOAuthDefinition = {
    providerId: "example-device",
    label: "Example Device Provider",
    strategy: "oauth2-device",
    deviceAuthorizationEndpoint: "https://accounts.example.test/oauth/device",
    tokenEndpoint: "https://accounts.example.test/oauth/token",
    clientId: "harness-device-client",
    scopes: ["models:run"],
    minimumPollingIntervalSeconds: 2
  };
  const device = createDeviceAuthorizationRequest(deviceDefinition);
  assert.equal(device.endpoint, deviceDefinition.deviceAuthorizationEndpoint);
  assert.equal(new URLSearchParams(device.body).get("client_id"), deviceDefinition.clientId);
  assert.equal(device.minimumPollingIntervalSeconds, 5);

  assert.throws(
    () => validateDirectProviderOAuthDefinition({ ...pkceDefinition, clientSecret: "must-not-exist" } as DirectProviderOAuthDefinition),
    /must not include a client secret/
  );
  assert.throws(
    () => validateDirectProviderOAuthDefinition({ ...pkceDefinition, tokenEndpoint: "http://accounts.example.test/token" }),
    /must use HTTPS/
  );
});

test("OS credential adapters keep secrets out of command arguments", async () => {
  const secret = JSON.stringify({ accessToken: "access_token=supersecretvalue" });
  for (const platform of ["darwin", "win32", "linux"] as const) {
    const calls: Array<{ executable: string; args: string[]; input?: string }> = [];
    const runner: CredentialCommandRunner = async (executable, args, input) => {
      calls.push({ executable, args, input });
      return { code: 0, stdout: secret };
    };
    const store = createOsCredentialStore(platform, runner);
    await store.set("example:account", secret);
    assert.equal(await store.get("example:account"), secret);
    await store.delete("example:account");
    assert.equal(calls[0]?.input, secret);
    assert.ok(calls.every((call) => !JSON.stringify(call.args).includes("supersecretvalue")));
  }

  const failing = createOsCredentialStore("linux", async () => ({ code: 2, stdout: "access_token=supersecretvalue" }));
  await assert.rejects(() => failing.set("example:account", secret), (error: Error) => {
    assert.doesNotMatch(error.message, /supersecretvalue/);
    return true;
  });
});

test("direct provider credentials stay in the OS store while only references enter Harness data", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-direct-oauth-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const secrets = new Map<string, string>();
    const store: OsCredentialStore = {
      platform: "darwin",
      async set(reference, value) { secrets.set(reference, value); },
      async get(reference) { return secrets.get(reference) || null; },
      async delete(reference) { secrets.delete(reference); }
    };
    const manager = new DirectProviderAuthManager([pkceDefinition], store);
    assert.deepEqual(manager.capabilities(), [{
      providerId: pkceDefinition.providerId,
      label: pkceDefinition.label,
      strategy: pkceDefinition.strategy,
      scopes: pkceDefinition.scopes
    }]);
    const token = "oauth-access-token-supersecretvalue";
    const invalidProjectPath = path.join(root, "not-a-project");
    writeFileSync(invalidProjectPath, "file blocks project layout", "utf8");
    await assert.rejects(() => manager.connect({ ...project, path: invalidProjectPath }, pkceDefinition.providerId, {
      displayName: "rollback@example.test",
      credential: { accessToken: token }
    }));
    assert.equal(secrets.size, 0);
    assert.deepEqual(listOAuthAccountReferences(), []);

    const account = await manager.connect(project, pkceDefinition.providerId, {
      displayName: "developer@example.test",
      credential: {
        accessToken: token,
        refreshToken: "oauth-refresh-token-supersecretvalue",
        expiresAt: "2026-08-01T00:00:00.000Z",
        scopes: ["models:run"]
      }
    });
    assert.equal((await manager.credential(pkceDefinition.providerId, account.id))?.accessToken, token);
    assert.equal(listOAuthAccountReferences()[0]?.id, account.id);
    assert.deepEqual(listProjectOAuthAccountLinks(project.path).map((link) => ({
      providerId: link.providerId,
      accountReference: link.accountReference,
      displayName: link.displayName
    })), [{
      providerId: pkceDefinition.providerId,
      accountReference: account.id,
      displayName: "developer@example.test"
    }]);

    const persistedFiles = [
      ...filesUnder(globalHarnessDir()),
      ...filesUnder(path.join(project.path, ".harness"))
    ];
    assert.ok(persistedFiles.length > 0);
    for (const file of persistedFiles) {
      const contents = readFileSync(file);
      assert.equal(contents.includes(token), false, `${file} must not contain the OAuth access token`);
      assert.equal(contents.includes("oauth-refresh-token-supersecretvalue"), false, `${file} must not contain the OAuth refresh token`);
    }

    const catalog = listRuntimeProviders();
    assert.ok(catalog.llmProviders.every((provider) => provider.directAuthentication === undefined));
    assert.doesNotMatch(JSON.stringify(catalog), /oauth-access-token-supersecretvalue/);

    await manager.disconnect(project, pkceDefinition.providerId, account.id);
    assert.equal(secrets.size, 0);
    assert.deepEqual(listOAuthAccountReferences(), []);
    assert.deepEqual(listProjectOAuthAccountLinks(project.path), []);

    const unavailable = new DirectProviderAuthManager([], store);
    await assert.rejects(
      () => unavailable.connect(project, pkceDefinition.providerId, { displayName: "No provider", credential: { accessToken: token } }),
      /not enabled/
    );
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}
