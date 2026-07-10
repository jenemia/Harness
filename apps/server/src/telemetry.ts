import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type TracerProvider
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export const harnessTelemetryVersion = 1;
export const harnessSpanNames = [
  "plan.create", "draft.review", "draft.apply", "scheduler.dispatch", "provider.run",
  "provider.event", "interaction.wait", "interaction.resume", "review.open", "review.comment",
  "mcp.tool", "handoff.evaluate", "workspace.commit", "merge.apply", "recovery.audit"
] as const;

type HarnessSpanName = typeof harnessSpanNames[number] | "application.command";
type SpanOperation<T> = (span: Span) => T;

let provider: NodeTracerProvider | null = null;
let initialized = false;

export function initializeTelemetry() {
  if (initialized) return telemetryDiagnostics();
  initialized = true;
  if (!telemetryRequested()) return telemetryDiagnostics();
  try {
    const timeoutMillis = positiveInteger(process.env.HARNESS_OTLP_TIMEOUT_MS, 2000);
    const configuredUrl = process.env.HARNESS_OTLP_TRACES_ENDPOINT?.trim();
    const exporter = new OTLPTraceExporter({
      ...(configuredUrl ? { url: configuredUrl } : {}),
      timeoutMillis
    });
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim() || "harness",
        [ATTR_SERVICE_VERSION]: "0.1.0",
        "harness.telemetry.schema_version": harnessTelemetryVersion
      }),
      spanProcessors: [new BatchSpanProcessor(exporter, {
        exportTimeoutMillis: timeoutMillis,
        scheduledDelayMillis: Math.min(1000, timeoutMillis),
        maxQueueSize: 512,
        maxExportBatchSize: 128
      })],
      forceFlushTimeoutMillis: timeoutMillis,
      spanLimits: { attributeValueLengthLimit: 256, attributeCountLimit: 32, eventCountLimit: 32 }
    });
    provider.register();
  } catch {
    provider = null;
  }
  return telemetryDiagnostics();
}

export function telemetryDiagnostics() {
  return {
    enabled: Boolean(provider),
    requested: telemetryRequested(),
    exporter: provider ? "otlp-http" : "none",
    endpoint: process.env.HARNESS_OTLP_TRACES_ENDPOINT?.trim() || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || null,
    timeoutMillis: positiveInteger(process.env.HARNESS_OTLP_TIMEOUT_MS, 2000),
    schemaVersion: harnessTelemetryVersion
  };
}

export async function shutdownTelemetry() {
  const active = provider;
  provider = null;
  if (!active) return;
  try {
    await active.shutdown();
  } catch {
    // Exporter shutdown must never fail the application lifecycle.
  }
}

export function withTelemetrySpan<T>(name: HarnessSpanName, attributes: Attributes, operation: SpanOperation<T>): T {
  const tracer = trace.getTracer("harness", String(harnessTelemetryVersion));
  const span = tracer.startSpan(name, { attributes: safeAttributes(attributes) });
  const activeContext = trace.setSpan(context.active(), span);
  try {
    const result = context.with(activeContext, () => operation(span));
    if (isPromiseLike(result)) {
      return result.then(
        (value) => {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return value;
        },
        (error) => {
          markSpanFailed(span, error);
          span.end();
          throw error;
        }
      ) as T;
    }
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    return result;
  } catch (error) {
    markSpanFailed(span, error);
    span.end();
    throw error;
  }
}

export function currentTraceContext() {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return null;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function operationSpanName(operation: string): HarnessSpanName {
  if (operation === "plans:create" || operation === "tasks:create-from-prompt") return "plan.create";
  if (operation.startsWith("drafts:apply") || operation === "drafts:restore-revision") return "draft.apply";
  if (operation.startsWith("drafts:") && /review|reply/.test(operation)) return "draft.review";
  if (operation === "projects:schedule" || operation === "tasks:schedule" || operation === "tasks:start") return "scheduler.dispatch";
  if (operation === "interactions:respond") return "interaction.resume";
  if (operation.startsWith("reviews:comment") || operation === "reviews:followup") return "review.comment";
  if (operation.startsWith("reviews:")) return "review.open";
  if (operation === "projects:init-git") return "workspace.commit";
  if (operation === "tasks:merge" || operation === "tasks:resolve-merge") return "merge.apply";
  if (operation.includes("recover")) return "recovery.audit";
  return "application.command";
}

export function correlationAttributes(value: unknown, operation?: string): Attributes {
  const input = isRecord(value) ? value : {};
  return safeAttributes({
    "harness.operation": operation,
    "harness.project.id": stringValue(input.projectId),
    "harness.task.id": stringValue(input.taskId),
    "harness.run.id": stringValue(input.runId),
    "harness.agent.id": stringValue(input.agentId),
    "harness.provider.id": stringValue(input.providerId),
    "harness.draft.id": stringValue(input.draftId),
    "harness.interaction.id": stringValue(input.interactionId)
  });
}

function markSpanFailed(span: Span, error: unknown) {
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.addEvent("operation.failed", {
    "error.type": error instanceof Error ? error.name.slice(0, 80) : "Error"
  });
}

function safeAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) =>
    typeof value === "boolean" || typeof value === "number" || (typeof value === "string" && value.length > 0)
  ).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 256) : value]));
}

function telemetryRequested() {
  if (process.env.OTEL_SDK_DISABLED?.toLowerCase() === "true") return false;
  return process.env.HARNESS_TELEMETRY_ENABLED?.toLowerCase() === "true" ||
    process.env.OTEL_TRACES_EXPORTER?.toLowerCase() === "otlp" ||
    Boolean(process.env.HARNESS_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPromiseLike<T>(value: T): value is T & Promise<Awaited<T>> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
