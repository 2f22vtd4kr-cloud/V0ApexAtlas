---
name: Artifact workflow setup
description: How managed artifact workflows are configured and the port conflict resolution that was needed
---

## Managed Workflows (current)

When the artifact registry is populated, all four artifacts run via artifact-managed workflows:
- `artifacts/api-server: API Server` — port 8080, path `/api`
- `artifacts/apex-finder: web` — Vite frontend, path `/`
- `artifacts/apex-mobile: expo` — Expo dev server, path `/apex-mobile/`
- `artifacts/mockup-sandbox: Component Preview Server` — design sandbox, path `/__mockup`

An imported repository can contain the `.replit-artifact/artifact.toml` files while the
platform artifact registry is empty. In that state, the manually configured workflows
can still run and serve the app, but artifact-based screenshot/presentation lookup cannot
resolve the project until registration is repaired.

After registration, validate the existing manifests through the artifact registration
flow rather than creating new artifacts. Remove any temporary manual workflows and clear
their orphaned listeners before starting the restored managed services.

**Why:** GitHub imports can preserve artifact files without preserving the platform
registry; leaving manual services alive causes `EADDRINUSE` when managed services return.

**How to apply:** On an imported workspace, check `listArtifacts()` before starting app
services. If empty but manifests exist, validate each existing manifest, then use the
exact managed workflow names and clean stale processes from the old manual services.

## Port conflict history

During setup, two old **manual** workflows ("API Server" on PORT=8080, "ApexFinder Frontend" on PORT=5173) were holding ports after the artifacts were registered. Resolution:
1. `removeWorkflow` for both manual workflows
2. The old API server process (PID 449) didn't die immediately — had to `kill -9 <pid>` to free port 8080
3. Then `WorkflowsRestart` on the managed API server succeeded

**Why:** When a GitHub-imported project is set up, manual workflows precede artifact registration. After registering artifacts, remove any duplicate manual workflows and kill lingering processes before restarting managed ones.

## Do NOT use configureWorkflow for artifact services
Per the workflows skill: managed artifact workflows inject PORT, BASE_PATH, and proxy routing automatically. Using configureWorkflow for an artifact service creates conflicts.
