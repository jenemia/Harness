export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(apiErrorMessage(body) || response.statusText || "Request failed.");
  }

  return body as T;
}

export function apiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  for (const key of ["error", "message", "reason"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return apiErrorMessage(value.result);
}
