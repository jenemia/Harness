export type OverlaySettings = { enabled: boolean; privacyMode: boolean; reducedMotion: boolean; anchor: "bottom-left" | "bottom-right"; displayId: string | null; maximumDogs: number; opacity: number; visibleAcrossWorkspaces: boolean; fullscreenPolicy: "show" | "hide"; quickHideShortcut: boolean };
export function readOverlaySettings(environment = process.env): OverlaySettings {
  return {
    enabled: environment.HARNESS_DOG_OVERLAY === "true",
    privacyMode: environment.HARNESS_DOG_OVERLAY_PRIVACY !== "false",
    reducedMotion: environment.HARNESS_DOG_OVERLAY_REDUCED_MOTION === "true",
    anchor: environment.HARNESS_DOG_OVERLAY_ANCHOR === "bottom-left" ? "bottom-left" : "bottom-right",
    displayId: environment.HARNESS_DOG_OVERLAY_DISPLAY?.trim() || null,
    maximumDogs: Math.min(5, Math.max(1, Number(environment.HARNESS_DOG_OVERLAY_MAX || 5))),
    opacity: Math.min(1, Math.max(0.3, Number(environment.HARNESS_DOG_OVERLAY_OPACITY || 0.94))),
    visibleAcrossWorkspaces: environment.HARNESS_DOG_OVERLAY_ALL_SPACES !== "false",
    fullscreenPolicy: environment.HARNESS_DOG_OVERLAY_FULLSCREEN === "show" ? "show" : "hide",
    quickHideShortcut: environment.HARNESS_DOG_OVERLAY_SHORTCUT === "true"
  };
}
