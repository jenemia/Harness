import { BrowserWindow, screen } from "electron";
import type { OverlayAnchor, OverlayDisplay, OverlayPlatformAdapter, OverlayWindowHandle, OverlayWindowOptions } from "./types.js";

export class MacOverlayPlatformAdapter implements OverlayPlatformAdapter {
  readonly supported = true;
  private handle: OverlayWindowHandle | null = null;
  private options: OverlayWindowOptions | null = null;
  async createWindow(options: OverlayWindowOptions) {
    this.options = options;
    const window = new BrowserWindow({ width: options.width, height: options.height, transparent: true, frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setOpacity(options.opacity);
    window.setVisibleOnAllWorkspaces(options.visibleAcrossWorkspaces, { visibleOnFullScreen: options.fullscreenPolicy === "show" });
    this.handle = { window, setHtml: (html) => window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`), setState: async (state) => { await window.webContents.executeJavaScript(`window.renderHarnessOverlay(${JSON.stringify(state)})`, true); }, show: () => window.showInactive(), hide: () => window.hide(), destroy: () => window.destroy() };
    await this.updateBounds(options.displayId || null, options.anchor);
    return this.handle;
  }
  async updateBounds(displayId: string | null, anchor: OverlayAnchor) { if (!this.handle || !this.options) return; const displays = screen.getAllDisplays(); const display = displays.find((item) => String(item.id) === displayId) || screen.getPrimaryDisplay(); const { workArea } = display; const x = anchor === "bottom-left" ? workArea.x + 18 : workArea.x + workArea.width - this.options.width - 18; const y = workArea.y + workArea.height - this.options.height - 18; this.handle.window.setBounds({ x, y, width: this.options.width, height: this.options.height }); }
  async setInputPassthrough() { this.handle?.window.setIgnoreMouseEvents(true, { forward: true }); }
  async setAlwaysOnTop(enabled: boolean) { this.handle?.window.setAlwaysOnTop(enabled, "floating"); }
  async setVisibleAcrossWorkspaces(enabled: boolean) { this.handle?.window.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: this.options?.fullscreenPolicy === "show" }); }
  async setFullscreenPolicy(policy: "show" | "hide") { if (this.options) this.options.fullscreenPolicy = policy; await this.setVisibleAcrossWorkspaces(Boolean(this.options?.visibleAcrossWorkspaces)); }
  async listDisplays(): Promise<OverlayDisplay[]> { return screen.getAllDisplays().map((display) => ({ id: String(display.id), label: display.label || `Display ${display.id}`, bounds: display.workArea, scaleFactor: display.scaleFactor })); }
  onDisplaysChanged(listener: () => void) { screen.on("display-added", listener); screen.on("display-removed", listener); screen.on("display-metrics-changed", listener); return () => { screen.off("display-added", listener); screen.off("display-removed", listener); screen.off("display-metrics-changed", listener); }; }
}
