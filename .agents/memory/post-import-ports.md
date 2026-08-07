---
name: Post-import port conflicts
description: Orphaned Node/Vite processes hold ports 8080 and 23695 after the manual "Start application" workflow is removed; must be killed before artifact-managed workflows can bind.
---

## Rule
After any session where a manual combined workflow (e.g. `PORT=8080 ... & PORT=23695 ...`) was used, killing that workflow leaves orphaned processes holding the ports. Duplicate artifact-managed web workflows can produce the same `EADDRINUSE` symptom; the canonical workflow must own the preview port.

**Why:** Replit's workflow kill sends SIGTERM to the shell wrapper, but the background `&` child (one of the two servers) may not receive it and continues holding the port.

## How to apply
Before restarting artifact-managed workflows after removing a manual workflow:

```bash
kill -9 $(lsof -ti:8080 -ti:23695 2>/dev/null) 2>/dev/null; echo "ports cleared"
```

Then restart the canonical artifact workflow normally. A duplicate managed artifact workflow may not be removable through the workflow API, so stop its process/workflow entry when possible and do not restart all aliases. Verify the canonical preview and `curl localhost:8080/api/healthz`.
