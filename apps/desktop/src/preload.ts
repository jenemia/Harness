import { contextBridge, ipcRenderer } from "electron";
import {
  harnessIpcVersion,
  type HarnessCommand,
  type HarnessCommandInputs,
  type HarnessEvent,
  type HarnessEventFilters
} from "@harness/core";

const allowedEvents = new Set<HarnessEvent>(["provider:event", "draft:event", "agent:event"]);
let nextSubscriptionId = 0;

contextBridge.exposeInMainWorld("harness", {
  version: harnessIpcVersion,
  invoke<C extends HarnessCommand>(command: C, payload: HarnessCommandInputs[C]) {
    return ipcRenderer.invoke("harness:invoke", { version: harnessIpcVersion, command, payload });
  },
  subscribe<E extends HarnessEvent>(event: E, filter: HarnessEventFilters[E], callback: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) throw new Error(`Unsupported Harness event: ${event}`);
    const subscriptionId = `${Date.now()}-${++nextSubscriptionId}`;
    const channel = `harness:event:${subscriptionId}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    let active = true;
    void ipcRenderer.invoke("harness:subscribe", { version: harnessIpcVersion, event, filter, subscriptionId })
      .then(() => {
        if (!active) ipcRenderer.send("harness:unsubscribe", { subscriptionId });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      ipcRenderer.removeListener(channel, listener);
      ipcRenderer.send("harness:unsubscribe", { subscriptionId });
    };
  }
});
