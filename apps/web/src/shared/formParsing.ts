export function parseLabels(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  );
}

export function parseListText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function parseStringMapText(value: string, label: string) {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, entry]) => [
        key.trim(),
        typeof entry === "string" ? entry.trim() : "",
      ])
      .filter(([key, entry]) => key && entry),
  );
}
