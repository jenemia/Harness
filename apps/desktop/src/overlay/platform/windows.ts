import type { OverlayAnchor, OverlayPlatformAdapter, OverlayWindowOptions } from "./types.js";
export class WindowsOverlayPlatformAdapter implements OverlayPlatformAdapter {
  readonly supported = false;
  async createWindow(_options: OverlayWindowOptions): Promise<never> { throw new Error("Windows Agent Dog Overlay is not implemented yet."); }
  async updateBounds(_displayId: string | null, _anchor: OverlayAnchor) {}
  async setInputPassthrough() {}
  async setAlwaysOnTop(_enabled: boolean) {}
  async setVisibleAcrossWorkspaces(_enabled: boolean) {}
  async setFullscreenPolicy(_policy: "show" | "hide") {}
  async listDisplays() { return []; }
  onDisplaysChanged(_listener: () => void) { return () => undefined; }
}
