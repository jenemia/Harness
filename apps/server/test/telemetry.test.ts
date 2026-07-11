import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { invokeApplicationCommand } from "../src/application.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { registerProjectService } from "../src/services.js";
import {
  currentTraceContext,
  harnessSpanNames,
  telemetryDiagnostics,
  withTelemetrySpan
} from "../src/telemetry.js";

test("telemetry preserves trace lineage without collecting content and links SQLite audit events", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-telemetry-"));
  const previousHome = process.env.HARNESS_HOME;
  const previousEnabled = process.env.HARNESS_TELEMETRY_ENABLED;
  process.env.HARNESS_HOME = path.join(root, "home");
  delete process.env.HARNESS_TELEMETRY_ENABLED;
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
  try {
    assert.equal(telemetryDiagnostics().requested, false);
    assert.deepEqual(new Set(harnessSpanNames).size, harnessSpanNames.length);
    const project = registerProjectService({ path: path.join(root, "project"), seedDefaults: true }).project;
    const privateMarker = "PRIVATE_PROMPT_MARKER";
    await withTelemetrySpan("application.command", { "harness.operation": "scenario" }, async () => {
      const context = currentTraceContext();
      assert.match(context?.traceId || "", /^[a-f0-9]{32}$/);
      await invokeApplicationCommand("tasks:create-from-prompt", { projectId: project.id, prompt: privateMarker });
    });
    assert.throws(() => withTelemetrySpan("application.command", { "harness.operation": "failure" }, () => {
      throw new Error(`do not export ${privateMarker}`);
    }), /do not export/);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    assert.ok(spans.some((span) => span.name === "plan.create"));
    const scenario = spans.find((span) => span.attributes["harness.operation"] === "scenario");
    const plan = spans.find((span) => span.name === "plan.create");
    assert.equal(plan?.spanContext().traceId, scenario?.spanContext().traceId);
    assert.doesNotMatch(JSON.stringify(spans.map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events
    }))), new RegExp(privateMarker));

    const planEvent = getProjectOverview(project).events.find((event) => event.type === "plan.created");
    assert.equal(planEvent?.metadata.traceId, plan?.spanContext().traceId);
    assert.match(String(planEvent?.metadata.spanId || ""), /^[a-f0-9]{16}$/);
  } finally {
    trace.disable();
    await provider.shutdown();
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    if (previousEnabled === undefined) delete process.env.HARNESS_TELEMETRY_ENABLED;
    else process.env.HARNESS_TELEMETRY_ENABLED = previousEnabled;
    rmSync(root, { recursive: true, force: true });
  }
});
