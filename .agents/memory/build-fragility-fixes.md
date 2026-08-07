---
name: Build fragility fixes applied
description: PORT invalid-value throws replaced with graceful fallbacks across all three Vite/Node artifacts; coldStartRecovery unhandled rejection fixed
---

## Fixes applied (all confirmed working after restart)

### artifacts/api-server/src/index.ts
- PORT: replaced `throw` on NaN/≤0 with silent fallback to 8080
  ```ts
  const parsedPort = Number(rawPort);
  const port = (Number.isNaN(parsedPort) || parsedPort <= 0) ? 8080 : parsedPort;
  ```
- coldStartRecovery(): added inner `.catch()` so an unhandled rejection can't crash the process:
  ```ts
  connectPermanentRedis()
    .then(() => coldStartRecovery().catch((e) => logger.warn(...)))
    .catch((e) => logger.warn(...));
  ```

### artifacts/apex-finder/vite.config.ts
- PORT: replaced `throw` on NaN/≤0 with silent fallback to 23695

### artifacts/mockup-sandbox/vite.config.ts
- PORT: replaced `throw` on NaN/≤0 with silent fallback to 8081

### lib/db/src/index.ts
- DATABASE_URL `throw` intentionally kept — DB is a hard requirement; clear message already present

**Why:** Managed workflows inject PORT/BASE_PATH *after* the artifact is registered. During the brief window before registration (or on a fresh import before the workflow fires), the env var is missing and the old code threw, causing the startup crash the user experienced on import.
**How to apply:** Any new artifact vite.config should use the "parsedPort with fallback" pattern. Never hard-throw on PORT absence.
