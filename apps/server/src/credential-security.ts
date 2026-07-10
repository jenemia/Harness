const credentialPatterns = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{10,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret)\s*(?::|=|\s)\s*["']?)[A-Za-z0-9_./+-]{8,}/gi
];

export function containsCredentialMaterial(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return false;
  return credentialPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function assertNoCredentialMaterial(value: unknown, label = "Value") {
  if (containsCredentialMaterial(value)) {
    throw new Error(`${label} cannot contain API keys, tokens, or credentials. Use the CLI's existing login session.`);
  }
}

export function redactCredentialMaterial(value: string | null | undefined) {
  if (!value) return value || "";
  return credentialPatterns.reduce((text, pattern) => {
    pattern.lastIndex = 0;
    return text.replace(pattern, (_match, prefix?: unknown) => `${typeof prefix === "string" ? prefix : ""}[REDACTED]`);
  }, value);
}
