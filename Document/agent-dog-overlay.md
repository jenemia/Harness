# Agent Dog Overlay

The macOS Agent Dog Overlay is an optional, read-only desktop status surface. It is disabled by default and never starts a server, captures the screen, requests Accessibility permission, or accepts clicks.

Enable it when launching the desktop:

```bash
HARNESS_DOG_OVERLAY=true pnpm dev:desktop
```

Safe environment settings:

- `HARNESS_DOG_OVERLAY_PRIVACY=false` allows known project/task titles; privacy is otherwise on.
- `HARNESS_DOG_OVERLAY_REDUCED_MOTION=true` freezes sprite motion.
- `HARNESS_DOG_OVERLAY_ANCHOR=bottom-left` changes the default bottom-right anchor.
- `HARNESS_DOG_OVERLAY_DISPLAY=<electron-display-id>` selects a display.
- `HARNESS_DOG_OVERLAY_MAX=1..5` limits visible agents.
- `HARNESS_DOG_OVERLAY_OPACITY=0.3..1` changes opacity.
- `HARNESS_DOG_OVERLAY_ALL_SPACES=false` limits Spaces visibility.
- `HARNESS_DOG_OVERLAY_FULLSCREEN=show` opts into full-screen visibility.
- `HARNESS_DOG_OVERLAY_SHORTCUT=true` enables the opt-in `Cmd/Ctrl+Shift+H` quick hide shortcut.

Only project/task/run/agent/provider ids, event category, and timestamp cross the overlay sanitizer. Prompt, transcript, commands, absolute paths, source/diff content, credentials, and raw tool results are discarded. Tool events affect the bounded activity score but do not create toasts. Tooltip text has no invented percentage; it shows known phase, elapsed time, changed-file count, and interaction state.

The five CC0 prototype assets and provenance are in `apps/desktop/assets/agent-dogs`. The renderer/activity/toast modules have no OS checks. macOS window behavior is isolated in `MacOverlayPlatformAdapter`; `WindowsOverlayPlatformAdapter` is a compile-time stub implementing the same contract for a future Windows 11 implementation.
