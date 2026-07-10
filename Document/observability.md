# Harness observability

Harness tracing is disabled by default. Normal desktop, CLI, HTTP, and MCP use requires no collector, Jaeger, Phoenix, or network connection.

## Enable OTLP tracing

Start the optional local collector UI:

```bash
docker compose -f observability/docker-compose.yml up -d
```

Run Harness with OTLP/HTTP export enabled:

```bash
HARNESS_TELEMETRY_ENABLED=true \
HARNESS_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces \
HARNESS_OTLP_TIMEOUT_MS=2000 \
pnpm dev:desktop
```

The standard `OTEL_TRACES_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, and `OTEL_SERVICE_NAME` variables are also supported by the OpenTelemetry SDK. `OTEL_SDK_DISABLED=true` always disables Harness tracing. Open the optional Jaeger UI at `http://127.0.0.1:16686`.

Export uses a bounded batch queue and a two-second default timeout. Export and shutdown failures are swallowed so collector downtime cannot fail a task, provider run, MCP call, or application shutdown.

## Span contract

Schema version 1 uses these operation names:

- `plan.create`, `draft.review`, `draft.apply`
- `scheduler.dispatch`, `provider.run`, `provider.event`
- `interaction.wait`, `interaction.resume`
- `review.open`, `review.comment`, `mcp.tool`
- `handoff.evaluate`, `workspace.commit`, `merge.apply`, `recovery.audit`

Correlation attributes use the `harness.*.id` namespace for project, task, run, agent, provider, draft, and interaction identifiers. Retry, resume, rejection, timeout, and failure are span events or bounded status attributes. Every project audit event written while a span is active receives `traceId` and `spanId`, so the local timeline can be matched to an external trace.

Harness does not add prompts, comments, file content, command text, provider output, API keys, credentials, or exception messages to spans. Attribute values are allowlisted at call sites, capped at 256 characters, and limited by the SDK. Provider payload redaction and local credential guards continue to apply independently of telemetry.

## Verify

The deterministic in-memory exporter test requires no collector:

```bash
pnpm --filter @harness/server exec tsx --test test/telemetry.test.ts
```

It verifies parent/child trace lineage, SQLite audit linkage, default-disabled diagnostics, and content exclusion.
