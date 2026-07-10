import { app, BrowserWindow, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { harnessIpcVersion, isHarnessCommand, isHarnessCommandPayload, type HarnessInvokeRequest } from "@harness/core";
import { invokeApplicationCommand } from "@harness/server/application";
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

async function createWindow() {
  const window = new BrowserWindow(secureWindowOptions(preloadPath));
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
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
