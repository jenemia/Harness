import { contextBridge, ipcRenderer } from "electron";
import {
  harnessIpcVersion,
  type HarnessCommand,
  type HarnessCommandInputs,
  type HarnessEvent
} from "@harness/core";

const allowedEvents = new Set<HarnessEvent>(["provider:event"]);

contextBridge.exposeInMainWorld("harness", {
  version: harnessIpcVersion,
  invoke<C extends HarnessCommand>(command: C, payload: HarnessCommandInputs[C]) {
    return ipcRenderer.invoke("harness:invoke", { version: harnessIpcVersion, command, payload });
  },
  subscribe(event: HarnessEvent, callback: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) throw new Error(`Unsupported Harness event: ${event}`);
    const channel = `harness:event:${event}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
