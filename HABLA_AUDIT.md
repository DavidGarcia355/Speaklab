# Archived Habla audit

> **Historical only — do not use this file for launch or deployment decisions.**

The detailed audit that previously lived here described an older application
state. Its registration, billing, media-storage, privacy, and launch-readiness
claims are no longer accurate, so the stale operational guidance was removed on
2026-08-25.

Use these current sources instead:

- `README.md` for the guarded release and private-media migration runbook.
- `docs/environment-variables.md` for the current runtime and migration contract.
- `docs/subprocessors.md` plus the public `/privacy` and `/terms` pages for the
  current disclosure surface.
- `npm run release:check` from a clean branch based on current `origin/main` for
  the release gate.

Promotion still requires operator/legal signoff, a confirmed restorable database
backup, a successful media migration dry run and apply verification, and manual
authenticated browser smoke testing. Never treat an archived audit as approval
to deploy.
