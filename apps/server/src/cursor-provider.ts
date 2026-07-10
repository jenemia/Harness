import type { ProviderEventType } from "@harness/core";

export type NormalizedProviderEvent = {
  type: ProviderEventType;
  payload: Record<string, unknown>;
  metadata?: { originalEventType?: string };
};

export function parseCursorStreamLine(line: string): NormalizedProviderEvent | null {
  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) return null;
    event = parsed;
  } catch {
    return null;
  }

  const type = text(event.type);
  const subtype = text(event.subtype);
  const originalEventType = [type, subtype].filter(Boolean).join(".");
  const metadata = originalEventType ? { originalEventType } : undefined;

  if (type === "user") return null;
  if (type === "system" && subtype === "init") {
    return {
      type: "decision",
      payload: compact({
        phase: "session_initialized",
        sessionId: text(event.session_id),
        model: text(event.model),
        permissionMode: text(event.permissionMode)
      }),
      metadata
    };
  }
  if (type === "assistant") {
    const delta = assistantText(event.message);
    return delta ? {
      type: "text_delta",
      payload: { text: delta, sessionId: text(event.session_id) },
      metadata
    } : null;
  }
  if (type === "tool_call") {
    const toolCall = isRecord(event.tool_call) ? event.tool_call : {};
    const [toolName, detail] = Object.entries(toolCall)[0] || ["unknown", {}];
    const toolDetail = isRecord(detail) ? detail : {};
    const common = compact({
      callId: text(event.call_id),
      toolName,
      sessionId: text(event.session_id)
    });
    if (subtype === "started") {
      return {
        type: "tool_use",
        payload: { ...common, args: omitSensitiveToolContent(toolDetail.args) },
        metadata
      };
    }
    if (subtype === "completed") {
      return {
        type: "tool_result",
        payload: { ...common, result: omitSensitiveToolContent(toolDetail.result) },
        metadata
      };
    }
  }
  if (type === "result") {
    const isError = event.is_error === true || subtype === "error";
    return {
      type: isError ? "error" : "result",
      payload: compact({
        status: isError ? "failed" : "completed",
        summary: text(event.result),
        sessionId: text(event.session_id),
        requestId: text(event.request_id),
        durationMs: number(event.duration_ms),
        durationApiMs: number(event.duration_api_ms)
      }),
      metadata
    };
  }
  return null;
}

function assistantText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.content)) return "";
  return value.content
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
}

function omitSensitiveToolContent(value: unknown, key = ""): unknown {
  if (/^(content|fileText)$/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => omitSensitiveToolContent(item, key));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, omitSensitiveToolContent(nestedValue, nestedKey)]));
  }
  return value;
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
