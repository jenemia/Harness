import type { BrowserWindow } from "electron";
export type OverlayAnchor = "bottom-left" | "bottom-right";
export type OverlayDisplay = { id: string; label: string; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number };
export type OverlayWindowOptions = { width: number; height: number; anchor: OverlayAnchor; displayId?: string | null; opacity: number; visibleAcrossWorkspaces: boolean; fullscreenPolicy: "show" | "hide" };
export type OverlayWindowHandle = { window: BrowserWindow; setHtml(html: string): Promise<void>; setState(state: unknown): Promise<void>; show(): void; hide(): void; destroy(): void };
export interface OverlayPlatformAdapter {
  readonly supported: boolean;
  createWindow(options: OverlayWindowOptions): Promise<OverlayWindowHandle>;
  updateBounds(displayId: string | null, anchor: OverlayAnchor): Promise<void>;
  setInputPassthrough(): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  setVisibleAcrossWorkspaces(enabled: boolean): Promise<void>;
  setFullscreenPolicy(policy: "show" | "hide"): Promise<void>;
  listDisplays(): Promise<OverlayDisplay[]>;
  onDisplaysChanged(listener: () => void): () => void;
}
