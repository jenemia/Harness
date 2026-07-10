import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { HarnessCommand, HarnessCommandInputs } from "@harness/core";
import { isHarnessCommand, isHarnessCommandPayload } from "@harness/core";
import { globalHarnessDir } from "./db.js";
import { redactCredentialMaterial } from "./credential-security.js";
import { invokeApplicationCommand } from "./application.js";

type BridgeRequest = { version: 1; id: string; command: string; payload: unknown };
type BridgeResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

export type ApplicationBridgeHandle = {
  address: string;
  markerPath: string;
  stop(): Promise<void>;
};

export function applicationBridgeAddress() {
  const home = globalHarnessDir();
  if (process.platform === "win32") {
    const digest = createHash("sha256").update(home).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\harness-${digest}`;
  }
  return path.join(home, "runtime", "application.sock");
}

export function applicationBridgeMarkerPath() {
  return path.join(globalHarnessDir(), "runtime", "application-bridge.json");
}

export async function startApplicationBridge(): Promise<ApplicationBridgeHandle> {
  const address = applicationBridgeAddress();
  const markerPath = applicationBridgeMarkerPath();
  mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && existsSync(address)) {
    if (await canConnect(address, 250)) throw new Error("Harness application bridge is already active.");
    rmSync(address, { force: true });
  }
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) void handleBridgeLine(socket, line);
        newline = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(address, () => {
      server.off("error", onError);
      resolve();
    });
  });
  if (process.platform !== "win32") chmodSync(address, 0o600);
  writeFileSync(markerPath, `${JSON.stringify({ version: 1, pid: process.pid, address, startedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(markerPath, 0o600);
  return {
    address,
    markerPath,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(markerPath, { force: true });
      if (process.platform !== "win32") rmSync(address, { force: true });
    }
  };
}

export async function invokeApplicationBridge<C extends HarnessCommand>(
  command: C,
  payload: HarnessCommandInputs[C]
): Promise<{ available: false } | { available: true; result: unknown }> {
  const marker = readBridgeMarker();
  if (!marker || !isProcessAlive(marker.pid)) {
    if (marker) rmSync(applicationBridgeMarkerPath(), { force: true });
    return { available: false };
  }
  const id = randomUUID();
  try {
    const response = await new Promise<BridgeResponse>((resolve, reject) => {
      const socket = net.createConnection(marker.address);
      let buffer = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Harness application bridge timed out."));
      }, 5000);
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        socket.end();
        try {
          resolve(JSON.parse(buffer.slice(0, newline)) as BridgeResponse);
        } catch {
          reject(new Error("Harness application bridge returned invalid JSON."));
        }
      });
      socket.once("connect", () => {
        socket.write(`${JSON.stringify({ version: 1, id, command, payload })}\n`);
      });
    });
    if (!response.ok) throw new Error(response.error);
    return { available: true, result: response.result };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ECONNREFUSED" || code === "EPIPE") return { available: false };
    throw error;
  }
}

export function applicationBridgeDiagnostics() {
  const marker = readBridgeMarker();
  return {
    address: applicationBridgeAddress(),
    markerPath: applicationBridgeMarkerPath(),
    markerPresent: Boolean(marker),
    active: Boolean(marker && isProcessAlive(marker.pid)),
    pid: marker?.pid || null
  };
}

async function handleBridgeLine(socket: net.Socket, line: string) {
  let request: BridgeRequest | null = null;
  try {
    request = JSON.parse(line) as BridgeRequest;
    if (!request || request.version !== 1 || typeof request.id !== "string" || !isHarnessCommand(request.command) ||
        !isHarnessCommandPayload(request.command, request.payload)) {
      throw new Error("Invalid Harness application bridge request.");
    }
    const result = await invokeApplicationCommand(request.command, request.payload as never);
    writeBridgeResponse(socket, { id: request.id, ok: true, result });
  } catch (error) {
    writeBridgeResponse(socket, {
      id: request?.id || "unknown",
      ok: false,
      error: redactCredentialMaterial(error instanceof Error ? error.message : String(error))
    });
  }
}

function writeBridgeResponse(socket: net.Socket, response: BridgeResponse) {
  socket.write(`${JSON.stringify(response)}\n`);
}

function readBridgeMarker() {
  const markerPath = applicationBridgeMarkerPath();
  if (!existsSync(markerPath)) return null;
  try {
    const value = JSON.parse(readFileSync(markerPath, "utf8")) as { version?: number; pid?: number; address?: string };
    if (value.version !== 1 || !Number.isSafeInteger(value.pid) || typeof value.address !== "string") return null;
    return { pid: Number(value.pid), address: value.address };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function canConnect(address: string, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(address);
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}
