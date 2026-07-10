#!/usr/bin/env node
import readline from "node:readline";
import { handleMcpMessage } from "./mcp.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";

initializeTelemetry();

const clientId = readArgument("--client") || process.env.HARNESS_MCP_CLIENT_ID || "local-readonly";
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
let pending = Promise.resolve();

input.on("line", (line) => {
  const value = line.trim();
  if (!value) return;
  pending = pending.then(() => processLine(value));
});

input.on("close", () => {
  void pending.finally(() => shutdownTelemetry()).then(() => {
  process.exitCode = 0;
  });
});

async function processLine(line: string) {
  try {
    const response = await handleMcpMessage(JSON.parse(line), clientId);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Invalid JSON." }
    })}\n`);
  }
}

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && typeof process.argv[index + 1] === "string" ? process.argv[index + 1] : null;
}
