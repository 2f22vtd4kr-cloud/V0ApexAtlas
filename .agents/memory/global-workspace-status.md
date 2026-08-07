---
name: Global workspace status
description: The shared web header exposes live Atlas, service, and provider-capacity state on every route.
---

The web header's workspace indicator combines the live Atlas scheduler endpoint with API/database/Redis and AI-provider status. Active discovery/enrichment is shown separately from provider degradation; queued, ready, degraded, and offline states must remain truthful and must not be inferred from historical jobs.

**Why:** Users need to know whether the whole app is currently researching without navigating to Reactor, while provider limits should be visible without falsely implying that the application itself is down.

**How to apply:** Keep the indicator in the shared layout, poll live telemetry with a bounded interval, and link its detail popover to Reactor and system diagnostics.