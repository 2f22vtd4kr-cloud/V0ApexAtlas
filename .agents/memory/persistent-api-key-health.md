---
name: Persistent API key health
description: Shared web-header behavior for monitoring the provider key pools that power OSINT
---

The web app keeps API-key health visible in the shared header on every route. The collapsed control must communicate healthy, degraded, down, or unreachable state without requiring navigation; the expanded panel shows provider-level active, rate-limited, and missing slot counts and links to full system diagnostics.

**Why:** Provider availability directly determines OSINT coverage, so a page-local status screen is too easy to miss during research.

**How to apply:** Read `/api/system/status` through the shared frontend status helper, poll at the endpoint’s 15-second cache cadence, preserve the last good status during transient failures, and make the control usable at desktop and mobile widths. Treat configured keys as active unless that specific key receives a temporary 429; provider/account credit or auth responses are not per-key exhaustion.

Tavily's REST API requires `Authorization: Bearer <key>`; sending the key in the JSON body can produce misleading provider failures. A Tavily 432/plan response is provider/account state and must not suppress every configured key. Gemini/Tavily 429s use `Retry-After` when present and are surfaced as `rate_limited`, not `exhausted`.

**Why:** The provider dashboard showed configured Tavily keys with low individual usage while the app had marked them all exhausted. The main Tavily enrichment path was using the wrong authentication location and conflating account-level plan errors with per-key cooldowns.

**How to apply:** Keep provider account/credit diagnostics separate from slot state. Only mark a slot `rate_limited` after a real 429, honor its retry window, and leave 401/403/432 responses configured but unavailable for that request.