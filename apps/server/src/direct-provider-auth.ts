import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OsCredentialStore } from "./os-credential-store.js";
import type { ProjectRecord } from "./types.js";
import {
  deleteOAuthAccountReference,
  linkProjectOAuthAccount,
  saveOAuthAccountReference,
  unlinkProjectOAuthAccount
} from "./db.js";

export type PkceOAuthDefinition = {
  strategy: "oauth2-pkce";
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes: string[];
  redirectUris: string[];
};

export type DeviceOAuthDefinition = {
  strategy: "oauth2-device";
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes: string[];
  minimumPollingIntervalSeconds?: number;
};

export type DirectProviderOAuthDefinition = {
  providerId: string;
  label: string;
} & (PkceOAuthDefinition | DeviceOAuthDefinition);

export type DirectProviderOAuthCredential = {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scopes?: string[];
};

export class DirectProviderAuthManager {
  private readonly definitions = new Map<string, DirectProviderOAuthDefinition>();

  constructor(definitions: DirectProviderOAuthDefinition[], private readonly credentialStore: OsCredentialStore) {
    for (const definition of definitions) {
      validateDirectProviderOAuthDefinition(definition);
      if (this.definitions.has(definition.providerId)) throw new Error(`Duplicate direct provider OAuth definition: ${definition.providerId}`);
      this.definitions.set(definition.providerId, definition);
    }
  }

  capabilities() {
    return [...this.definitions.values()].map((definition) => ({
      providerId: definition.providerId,
      label: definition.label,
      strategy: definition.strategy,
      scopes: [...definition.scopes]
    }));
  }

  async connect(
    project: ProjectRecord,
    providerId: string,
    input: { displayName: string; credential: DirectProviderOAuthCredential }
  ) {
    const definition = this.requiredDefinition(providerId);
    validateOAuthCredential(input.credential);
    const accountReference = randomUUID();
    const credentialReference = credentialKey(providerId, accountReference);
    await this.credentialStore.set(credentialReference, JSON.stringify(input.credential));
    try {
      const account = saveOAuthAccountReference({
        id: accountReference,
        providerId,
        displayName: input.displayName,
        strategy: definition.strategy,
        scopes: input.credential.scopes || definition.scopes
      });
      linkProjectOAuthAccount(project.path, {
        providerId,
        accountReference,
        displayName: account.displayName
      });
      return account;
    } catch (error) {
      await this.credentialStore.delete(credentialReference).catch(() => undefined);
      deleteOAuthAccountReference(accountReference);
      throw error;
    }
  }

  async credential(providerId: string, accountReference: string) {
    this.requiredDefinition(providerId);
    const serialized = await this.credentialStore.get(credentialKey(providerId, accountReference));
    if (!serialized) return null;
    const credential = JSON.parse(serialized) as DirectProviderOAuthCredential;
    validateOAuthCredential(credential);
    return credential;
  }

  async disconnect(project: ProjectRecord, providerId: string, accountReference: string) {
    this.requiredDefinition(providerId);
    await this.credentialStore.delete(credentialKey(providerId, accountReference));
    unlinkProjectOAuthAccount(project.path, providerId, accountReference);
    deleteOAuthAccountReference(accountReference);
  }

  private requiredDefinition(providerId: string) {
    const definition = this.definitions.get(providerId);
    if (!definition) throw new Error(`Direct provider OAuth is not enabled for ${providerId}.`);
    return definition;
  }
}

export function createPkceAuthorizationRequest(definition: DirectProviderOAuthDefinition, redirectUri: string) {
  validateDirectProviderOAuthDefinition(definition);
  if (definition.strategy !== "oauth2-pkce") throw new Error("Provider does not support OAuth PKCE.");
  if (!definition.redirectUris.includes(redirectUri)) throw new Error("OAuth redirect URI is not registered for this provider.");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL(definition.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", definition.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", definition.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), verifier, challenge, state };
}

export function createDeviceAuthorizationRequest(definition: DirectProviderOAuthDefinition) {
  validateDirectProviderOAuthDefinition(definition);
  if (definition.strategy !== "oauth2-device") throw new Error("Provider does not support OAuth device authorization.");
  return {
    endpoint: definition.deviceAuthorizationEndpoint,
    body: new URLSearchParams({ client_id: definition.clientId, scope: definition.scopes.join(" ") }).toString(),
    minimumPollingIntervalSeconds: Math.max(5, definition.minimumPollingIntervalSeconds || 5)
  };
}

export function validateDirectProviderOAuthDefinition(definition: DirectProviderOAuthDefinition) {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(definition.providerId)) throw new Error("Invalid direct provider id.");
  if (!definition.label.trim() || !definition.clientId.trim()) throw new Error("Direct provider OAuth label and client id are required.");
  if ((definition as unknown as Record<string, unknown>).clientSecret !== undefined) throw new Error("Direct provider OAuth must not include a client secret.");
  assertHttpsEndpoint(definition.tokenEndpoint, "token");
  if (definition.strategy === "oauth2-pkce") {
    assertHttpsEndpoint(definition.authorizationEndpoint, "authorization");
    if (definition.redirectUris.length === 0) throw new Error("OAuth PKCE requires a registered redirect URI.");
    definition.redirectUris.forEach(assertSafeRedirectUri);
  } else {
    assertHttpsEndpoint(definition.deviceAuthorizationEndpoint, "device authorization");
  }
  if (definition.scopes.length === 0 || definition.scopes.some((scope) => !scope.trim())) throw new Error("Direct provider OAuth scopes are required.");
}

function validateOAuthCredential(credential: DirectProviderOAuthCredential) {
  if (!credential.accessToken?.trim()) throw new Error("OAuth access token is required.");
  if (credential.expiresAt && Number.isNaN(Date.parse(credential.expiresAt))) throw new Error("OAuth credential expiry must be an ISO timestamp.");
}

function assertHttpsEndpoint(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`OAuth ${label} endpoint must use HTTPS.`);
}

function assertSafeRedirectUri(value: string) {
  const url = new URL(value);
  const loopback = (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]"));
  if (url.protocol !== "https:" && !loopback) throw new Error("OAuth redirect URI must use HTTPS or an explicit loopback address.");
}

function credentialKey(providerId: string, accountReference: string) {
  if (!/^[0-9a-f-]{36}$/i.test(accountReference)) throw new Error("Invalid OAuth account reference.");
  return `${providerId}:${accountReference}`;
}
