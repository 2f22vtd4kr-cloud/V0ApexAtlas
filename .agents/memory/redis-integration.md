---
name: Redis integration
description: ioredis wired into api-server for caching; architecture decisions for cache keys, TTLs, and invalidation
---

## What's in place

- Package: `ioredis` installed in `artifacts/api-server`
- Client singleton: `artifacts/api-server/src/lib/redis.ts`
  - Reads `REDIS_URL` secret (supports redis:// and rediss:// TLS)
  - Lazy connect on startup via `connectRedis()` in index.ts
  - All cache ops are fire-and-forget — Redis failure never crashes the server
  - Exports: `getCache`, `setCache`, `delCache`, `delCachePattern`, `pingRedis`, `getRedisClient`
  - Key prefix: `apex:` (all keys namespaced)

## Cache locations

| Route | Cache key pattern | TTL | Invalidated by |
|---|---|---|---|
| GET /entities | `apex:entities:list:{type}:{minScore}:{search}:{limit}:{offset}` | 30 s | POST/PATCH/DELETE /entities |
| GET /dashboard/stats | `apex:dashboard:stats` | 60 s | POST/PATCH/DELETE /entities |
| GET /dashboard/map-data | `apex:dashboard:map` | 120 s | POST/PATCH/DELETE /entities |
| POST /registry-search | `apex:registry:{registry}:{query}:{limit}` | 3600 s | Never (external data) |

## Health check

GET /api/healthz now returns Redis status + latency:
`{"status":"ok","redis":{"status":"ok","latencyMs":163}}`

## Why

- Entity list and dashboard are expensive multi-join queries; 30-60 s cache cuts DB load
- Registry search calls external APIs (OpenCorporates, SEC EDGAR) which are slow and rate-limited; 1h cache prevents duplicate calls for same query
- Graceful degradation: if Redis is down, all routes fall through to PostgreSQL with no user-visible error

## Build note

esbuild externals already include `hiredis` (ioredis native addon) — ioredis falls back to pure JS automatically. No build.mjs changes needed.
