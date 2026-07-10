import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { harnessIpcVersion, isHarnessCommand, isHarnessCommandPayload, isHarnessEventFilter, type HarnessInvokeRequest, type ProviderEventEnvelope } from "@harness/core";
import { invokeApplicationCommand, recoverApplicationState, subscribeApplicationProviderEvents } from "@harness/server/application";
import { secureWindowOptions } from "./security.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(currentDir, "preload.js");
const rendererPath = process.env.HARNESS_RENDERER_PATH
  ? path.resolve(process.env.HARNESS_RENDERER_PATH)
  : path.resolve(currentDir, "../../web/dist/index.html");

ipcMain.handle("harness:invoke", async (_event, request: HarnessInvokeRequest) => {
  if (!request || request.version !== harnessIpcVersion || !isHarnessCommand(request.command) ||
      !isHarnessCommandPayload(request.command, request.payload)) {
    throw new Error("Unsupported Harness IPC request.");
  }
  return invokeApplicationCommand(request.command, request.payload);
});

const eventSubscriptions = new Map<string, { senderId: number; unsubscribe: () => void }>();

ipcMain.handle("harness:subscribe", (ipcEvent, request: unknown) => {
  const value = request as Record<string, unknown> | null;
  if (!value || value.version !== harnessIpcVersion || value.event !== "provider:event" ||
      typeof value.subscriptionId !== "string" || !isHarnessEventFilter("provider:event", value.filter)) {
    throw new Error("Unsupported Harness event subscription.");
  }
  const key = `${ipcEvent.sender.id}:${value.subscriptionId}`;
  eventSubscriptions.get(key)?.unsubscribe();
  const seen = new Map<string, number>();
  const send = (providerEvent: ProviderEventEnvelope) => {
    const cursor = seen.get(providerEvent.runId) || 0;
    if (providerEvent.sequence <= cursor || ipcEvent.sender.isDestroyed()) return;
    seen.set(providerEvent.runId, providerEvent.sequence);
    ipcEvent.sender.send(`harness:event:${value.subscriptionId}`, providerEvent);
  };
  const subscription = subscribeApplicationProviderEvents(value.filter, send);
  eventSubscriptions.set(key, { senderId: ipcEvent.sender.id, unsubscribe: subscription.unsubscribe });
  for (const providerEvent of subscription.replay) send(providerEvent);
  return { subscribed: true };
});

ipcMain.on("harness:unsubscribe", (ipcEvent, request: unknown) => {
  const subscriptionId = (request as { subscriptionId?: unknown } | null)?.subscriptionId;
  if (typeof subscriptionId !== "string") return;
  const key = `${ipcEvent.sender.id}:${subscriptionId}`;
  eventSubscriptions.get(key)?.unsubscribe();
  eventSubscriptions.delete(key);
});

async function createWindow() {
  const window = new BrowserWindow(secureWindowOptions(preloadPath));
  const rendererId = window.webContents.id;
  window.webContents.once("destroyed", () => {
    for (const [key, subscription] of eventSubscriptions) {
      if (subscription.senderId === rendererId) {
        subscription.unsubscribe();
        eventSubscriptions.delete(key);
      }
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  await window.loadFile(rendererPath);
  if (process.env.HARNESS_DESKTOP_SMOKE === "1") {
    console.log("Harness desktop smoke ready");
    const holdMs = Math.max(0, Number(process.env.HARNESS_DESKTOP_SMOKE_HOLD_MS || 0));
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
    window.destroy();
    app.quit();
    return;
  }
  window.show();
}

app.whenReady().then(async () => {
  recoverApplicationState();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
