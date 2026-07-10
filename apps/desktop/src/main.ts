import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { harnessIpcVersion, isHarnessCommand, isHarnessCommandPayload, isHarnessEventFilter, type DraftEventEnvelope, type HarnessEventFilters, type HarnessInvokeRequest, type ProviderEventEnvelope } from "@harness/core";
import { invokeApplicationCommand, recoverApplicationState, subscribeApplicationDraftEvents, subscribeApplicationProviderEvents } from "@harness/server/application";
import { startApplicationBridge, type ApplicationBridgeHandle } from "@harness/server/bridge";
import { initializeTelemetry, shutdownTelemetry } from "@harness/server/telemetry";
import { secureWindowOptions } from "./security.js";
import { AgentDogOverlayController } from "./overlay/overlay-controller.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(currentDir, "preload.js");
const rendererPath = process.env.HARNESS_RENDERER_PATH
  ? path.resolve(process.env.HARNESS_RENDERER_PATH)
  : path.resolve(currentDir, "../../web/dist/index.html");
let applicationBridge: ApplicationBridgeHandle | null = null;
let bridgeShutdownStarted = false;
const dogOverlay = new AgentDogOverlayController();

initializeTelemetry();

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
  if (!value || value.version !== harnessIpcVersion || typeof value.subscriptionId !== "string" ||
      (value.event !== "provider:event" && value.event !== "draft:event") || !isHarnessEventFilter(value.event, value.filter)) {
    throw new Error("Unsupported Harness event subscription.");
  }
  const key = `${ipcEvent.sender.id}:${value.subscriptionId}`;
  eventSubscriptions.get(key)?.unsubscribe();
  const channel = `harness:event:${value.subscriptionId}`;
  if (value.event === "draft:event") {
    let cursor = 0;
    const send = (draftEvent: DraftEventEnvelope) => {
      if (draftEvent.sequence <= cursor || ipcEvent.sender.isDestroyed()) return;
      cursor = draftEvent.sequence;
      ipcEvent.sender.send(channel, draftEvent);
    };
    const subscription = subscribeApplicationDraftEvents(value.filter as HarnessEventFilters["draft:event"], send);
    eventSubscriptions.set(key, { senderId: ipcEvent.sender.id, unsubscribe: subscription.unsubscribe });
    for (const draftEvent of subscription.replay) send(draftEvent);
    return { subscribed: true };
  }
  const seen = new Map<string, number>();
  const send = (providerEvent: ProviderEventEnvelope) => {
    const cursor = seen.get(providerEvent.runId) || 0;
    if (providerEvent.sequence <= cursor || ipcEvent.sender.isDestroyed()) return;
    seen.set(providerEvent.runId, providerEvent.sequence);
    ipcEvent.sender.send(channel, providerEvent);
  };
  const subscription = subscribeApplicationProviderEvents(value.filter as HarnessEventFilters["provider:event"], send);
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
  applicationBridge = await startApplicationBridge();
  await dogOverlay.start().catch(() => false);
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!applicationBridge || bridgeShutdownStarted) return;
  event.preventDefault();
  bridgeShutdownStarted = true;
  void Promise.all([applicationBridge.stop().catch(() => undefined), dogOverlay.stop().catch(() => undefined)]).then(() => shutdownTelemetry()).finally(() => {
    applicationBridge = null;
    app.quit();
  });
});
