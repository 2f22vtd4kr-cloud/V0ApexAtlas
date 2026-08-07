---
name: Imported artifact preview metadata
description: Environment behavior affecting preview screenshots after importing an existing artifact-based project
---

Imported projects may contain multiple copies of an artifact (for example a root source tree plus a nested imported copy), valid `.replit-artifact/artifact.toml` files, and managed workflows. The active workflow command and its Vite working directory determine which source is actually previewed; changing the nested copy alone can leave the live screenshot unchanged.

**Why:** Imported workspaces can have working app routing without refreshed artifact registration metadata, and duplicate artifact folders can look interchangeable while only one is used by the managed workflow.

**How to apply:** Verify the workflow command and Vite root first. Update the active source tree (and mirror the change only when the duplicate is intentionally retained), then verify through workflow logs, local/proxied HTTP health checks, a production build, and screenshots. Do not create replacement workflows just to satisfy the screenshot helper.