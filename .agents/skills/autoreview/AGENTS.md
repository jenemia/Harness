# Harness Autoreview Fork

- Upstream source: `openclaw/openclaw/.agents/skills/autoreview` at commit
  `a9ac13b2efd7ee7d4d1df5759c4c9ec15bd8e8f2`.
- This directory is intentionally vendored and adapted for Harness. Do not fetch or
  update it at runtime.
- Preserve `UPSTREAM_LICENSE` and the upstream commit above when changing or syncing
  this copy.
- Harness invokes the helper only with an explicit commit or an explicit cumulative
  base. Do not add PR discovery, `gh`, fetch, push, or Git hook behavior to the
  Harness integration.
