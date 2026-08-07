/**
 * Redis clients for ApexFinder API — dual-client architecture:
 *
 * LOCAL  (REDIS_URL)   — fast ephemeral cache; 30–120 s TTL items, API responses
 * PERMANENT (REDIS_URL_1) — Upstash; deduplication sets, job state, HNWI index
 *
 * All helpers fall back gracefully if a client is unavailable (Redis outage ≠ app crash).
 * If REDIS_URL_1 fills up, a REDIS_URL_2 can be hot-swapped in by adding it to the env
 * and calling connectPermanent() again — the first healthy client wins each call.
 */

import Redis from "ioredis";
import { logger } from "./logger";

// ── Client singletons ─────────────────────────────────────────────────────────

let _localClient: Redis | null = null;
let _permanentClients: Redis[] = []; // one per REDIS_URL_N

/**
 * Tracks which permanent-client slot indices are quota-exhausted.
 * An Upstash slot that hits its monthly request cap stays TCP-connected
 * (status === "ready") but throws ERR max requests limit exceeded on every
 * command.  We catch that in the error handler and add the index here so
 * getPermanentClient() skips it and falls through to the next healthy slot.
 *
 * RULE: Always skip quota-exhausted slots — never block on them.
 * If ALL slots are exhausted, request a new REDIS_URL_N from the user and
 * add it as the next slot (e.g. REDIS_URL_6) so the app can continue.
 */
const _quotaExhaustedSlots = new Set<number>();

function buildClient(url: string, label: string, slotIndex?: number): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    tls: url.startsWith("rediss://") ? {} : undefined,
    retryStrategy(times) {
      if (times > 20) return null;
      return Math.min(times * 200, 10_000);
    },
    reconnectOnError(err) {
      return err.message.includes("READONLY");
    },
  });

  client.on("connect",      () => logger.info(`[${label}] Redis connecting…`));
  client.on("ready",        () => logger.info(`[${label}] Redis ready`));
  client.on("error",        (err) => {
    if (err.message?.includes("max requests limit exceeded")) {
      if (slotIndex !== undefined && !_quotaExhaustedSlots.has(slotIndex)) {
        _quotaExhaustedSlots.add(slotIndex);
        logger.warn({ slot: slotIndex + 1, label }, `[${label}] Quota exhausted — slot marked as unavailable; falling through to next slot`);
      }
    } else {
      logger.warn({ err: err.message }, `[${label}] Redis error (non-fatal)`);
    }
  });
  client.on("close",        () => logger.warn(`[${label}] Redis connection closed`));
  client.on("reconnecting", (ms: number) => logger.info({ ms }, `[${label}] Redis reconnecting`));

  return client;
}

/** Connect the fast local cache client (REDIS_URL → localhost:6379) */
export async function connectRedis(): Promise<void> {
  if (_localClient) return;
  const url = process.env["REDIS_URL"];
  if (!url) {
    logger.warn("REDIS_URL not set — local cache disabled");
    return;
  }
  _localClient = buildClient(url, "local");
  try {
    await _localClient.connect();
    logger.info("Redis connection initiated");
  } catch (err: any) {
    logger.warn({ err: err.message }, "Redis initial connect failed — will retry in background");
  }
}

/**
 * Connect all permanent Upstash clients.
 * Reads REDIS_URL_1, REDIS_URL_2, … REDIS_URL_9 in order; stops at first missing key.
 */
export async function connectPermanentRedis(): Promise<void> {
  for (let i = 1; i <= 9; i++) {
    const url = process.env[`REDIS_URL_${i}`];
    if (!url) break;
    // Skip slots populated with placeholder text instead of a real Redis URL
    if (!url.startsWith("redis://") && !url.startsWith("rediss://")) {
      logger.warn({ slot: i }, "Permanent Redis slot skipped — invalid URL (not a redis:// URI)");
      break; // no point checking higher slots
    }
    if (_permanentClients[i - 1]) continue; // already connected
    const slotIndex = i - 1;
    const client = buildClient(url, `upstash-${i}`, slotIndex);
    try {
      await client.connect();
      _permanentClients[slotIndex] = client;
      logger.info({ slot: i }, "Permanent Redis connected");
    } catch (err: any) {
      logger.warn({ slot: i, err: err.message }, "Permanent Redis connect failed");
    }
  }
}

/** Shutdown all clients gracefully */
export async function disconnectRedis(): Promise<void> {
  const all = [_localClient, ..._permanentClients].filter(Boolean) as Redis[];
  await Promise.all(all.map((c) => c.quit().catch(() => c.disconnect())));
  _localClient = null;
  _permanentClients = [];
}

/** Fast local cache client — null if not connected */
export function getRedisClient(): Redis | null { return _localClient; }

/**
 * Returns the first healthy, non-quota-exhausted permanent client.
 * Falls back to local client if no permanent clients are available.
 *
 * Quota-exhausted slots (ERR max requests limit exceeded) stay TCP-connected
 * so their status remains "ready" — we skip them explicitly via
 * _quotaExhaustedSlots and fall through to the next slot automatically.
 */
export function getPermanentClient(): Redis | null {
  const alive = _permanentClients.find(
    (c, i) => c?.status === "ready" && !_quotaExhaustedSlots.has(i),
  );
  return alive ?? _localClient;
}

/** All permanent clients that are healthy and not quota-exhausted (for sharded writes) */
export function getAllPermanentClients(): Redis[] {
  return _permanentClients.filter(
    (c, i) => c?.status === "ready" && !_quotaExhaustedSlots.has(i),
  );
}

/** True if a given permanent slot (1-based) is quota-exhausted */
export function isSlotQuotaExhausted(slot: number): boolean {
  return _quotaExhaustedSlots.has(slot - 1);
}

/**
 * Mark a specific client instance as quota-exhausted.
 * Call this when a command-level ReplyError "max requests limit exceeded" is caught
 * BEFORE the ioredis `error` event fires, so subsequent getPermanentClient() calls
 * skip this slot immediately.
 */
export function markClientExhausted(client: Redis): void {
  const i = _permanentClients.indexOf(client);
  if (i >= 0 && !_quotaExhaustedSlots.has(i)) {
    _quotaExhaustedSlots.add(i);
    logger.warn({ slot: i + 1 }, `Permanent Redis slot ${i + 1} marked exhausted via command-level catch`);
  }
}

type RedisCommand<T> = (client: Redis) => Promise<T>;

/**
 * Run a permanent Redis command and fail over immediately when Upstash reports
 * its request quota is exhausted. This is deliberately centralized so callers
 * cannot accidentally keep selecting a TCP-ready but unusable slot.
 */
export async function withPermanentClient<T>(
  command: RedisCommand<T>,
  fallback: T,
): Promise<T> {
  const attempted = new Set<Redis>();
  for (;;) {
    const client = getPermanentClient();
    if (!client || attempted.has(client)) return fallback;
    attempted.add(client);
    try {
      return await command(client);
    } catch (err: any) {
      if (err?.message?.includes("max requests limit exceeded")) {
        markClientExhausted(client);
        continue;
      }
      logger.warn({ err: err?.message }, "Permanent Redis command failed (non-fatal)");
      return fallback;
    }
  }
}

/**
 * Same failover behavior as withPermanentClient, but prefers the dedicated
 * contact-cache slot before falling through to another healthy slot.
 */
export async function withContactCacheClient<T>(
  command: RedisCommand<T>,
  fallback: T,
): Promise<T> {
  const attempted = new Set<Redis>();
  for (;;) {
    const client = getContactCacheClient();
    if (!client || attempted.has(client)) return fallback;
    attempted.add(client);
    try {
      return await command(client);
    } catch (err: any) {
      if (err?.message?.includes("max requests limit exceeded")) {
        markClientExhausted(client);
        continue;
      }
      logger.warn({ err: err?.message }, "Contact-cache Redis command failed (non-fatal)");
      return fallback;
    }
  }
}

// ── LOCAL cache helpers (short-lived API responses) ───────────────────────────

const LOCAL_PREFIX = "apex:";

export async function getCache<T>(key: string): Promise<T | null> {
  const c = getRedisClient();
  if (!c) return null;
  try {
    const raw = await c.get(LOCAL_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export async function setCache(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const c = getRedisClient();
  if (!c) return;
  try { await c.set(LOCAL_PREFIX + key, JSON.stringify(value), "EX", ttlSeconds); } catch { /* non-fatal */ }
}

export async function delCache(...keys: string[]): Promise<void> {
  const c = getRedisClient();
  if (!c || keys.length === 0) return;
  try { await c.del(keys.map((k) => LOCAL_PREFIX + k)); } catch { /* non-fatal */ }
}

export async function delCachePattern(pattern: string): Promise<void> {
  const c = getRedisClient();
  if (!c) return;
  try {
    const fullPattern = LOCAL_PREFIX + pattern;
    const pipeline = c.pipeline();
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", fullPattern, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) pipeline.del(...keys);
    } while (cursor !== "0");
    await pipeline.exec();
  } catch { /* non-fatal */ }
}

// ── PERMANENT helpers (Upstash — dedup, job state, HNWI index) ───────────────

const PERM_PREFIX = "apex:";

export async function permGet<T>(key: string): Promise<T | null> {
  return withPermanentClient(async c => {
    const raw = await c.get(PERM_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  }, null);
}

export async function permSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  await withPermanentClient(async c => {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) await c.set(PERM_PREFIX + key, serialized, "EX", ttlSeconds);
    else await c.set(PERM_PREFIX + key, serialized);
  }, undefined);
}

export async function permHset(key: string, fields: Record<string, string | number>): Promise<void> {
  await withPermanentClient(c => c.hset(PERM_PREFIX + key, fields as any).then(() => undefined), undefined);
}

export async function permHgetall(key: string): Promise<Record<string, string> | null> {
  return withPermanentClient(async c => {
    const data = await c.hgetall(PERM_PREFIX + key);
    return Object.keys(data ?? {}).length > 0 ? data : null;
  }, null);
}

export async function permSadd(key: string, ...members: string[]): Promise<void> {
  await withPermanentClient(c => c.sadd(PERM_PREFIX + key, ...members).then(() => undefined), undefined);
}

export async function permSismember(key: string, member: string): Promise<boolean> {
  return withPermanentClient(async c => (await c.sismember(PERM_PREFIX + key, member)) === 1, false);
}

export async function permScard(key: string): Promise<number> {
  return withPermanentClient(c => c.scard(PERM_PREFIX + key), 0);
}

export async function permExpire(key: string, ttlSeconds: number): Promise<void> {
  await withPermanentClient(c => c.expire(PERM_PREFIX + key, ttlSeconds).then(() => undefined), undefined);
}

export async function pingRedis(): Promise<number | null> {
  const c = getRedisClient();
  if (!c) return null;
  try {
    const t0 = Date.now();
    await c.ping();
    return Date.now() - t0;
  } catch { return null; }
}

// ── CONTACT CACHE — slot 2 (REDIS_URL_2) ─────────────────────────────────────
//
// Persists enrichment results (email, phone, LinkedIn, etc.) across DB resets.
// Key format: "contact:v1:{sourceRegistries[0]}"  e.g. "contact:v1:faa:N12345"
// Stable across GitHub imports because sourceRegistry IDs come from source data.

const CONTACT_PREFIX = "contact:v1:";

/** Returns the second permanent client (slot 2 / REDIS_URL_2) for contact cache writes.
 *  Falls back to the first available non-quota-exhausted slot. */
export function getContactCacheClient(): Redis | null {
  // Prefer slot 2; skip if quota-exhausted
  const slot2 = _permanentClients[1];
  if (slot2?.status === "ready" && !_quotaExhaustedSlots.has(1)) return slot2;
  // Fall back to any healthy slot
  return getPermanentClient();
}

export interface CachedContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  phoneSource?: string | null;
  linkedinUrl?: string | null;
  linkedinHeadline?: string | null;
  twitterHandle?: string | null;
  twitterBio?: string | null;
  instagramHandle?: string | null;
  telegramHandle?: string | null;
  telegramBio?: string | null;
  personalWebsite?: string | null;
  foundationName?: string | null;
  website?: string | null;
  twitter?: string | null;
  contactConfidence: number;
  enrichmentSources: string[];
  enrichedAt: string;
  emailConfidence?: number;
  phoneConfidence?: number;
  sourceHits?: Record<string, number>;
  reviewOnlyContacts?: Array<Record<string, unknown>>;
}

/** Write contact data to Redis slot 2. No TTL — permanent. */
export async function contactCacheSet(stableKey: string, data: CachedContact): Promise<void> {
  await withContactCacheClient(
    c => c.set(CONTACT_PREFIX + stableKey, JSON.stringify(data)).then(() => undefined),
    undefined,
  );
}

/** Remove one permanent contact-cache entry. */
export async function contactCacheDelete(stableKey: string): Promise<void> {
  await withContactCacheClient(
    c => c.del(CONTACT_PREFIX + stableKey).then(() => undefined),
    undefined,
  );
}

/** Read contact data from Redis slot 2. */
export async function contactCacheGet(stableKey: string): Promise<CachedContact | null> {
  return withContactCacheClient(async c => {
    const raw = await c.get(CONTACT_PREFIX + stableKey);
    return raw ? (JSON.parse(raw) as CachedContact) : null;
  }, null);
}

/**
 * Scan all contact cache keys and return them as [stableKey, data] pairs.
 * Used by startup restore to backfill PostgreSQL from Redis.
 */
export async function contactCacheScanAll(): Promise<Array<{ key: string; data: CachedContact }>> {
  return withContactCacheClient(async c => {
    const results: Array<{ key: string; data: CachedContact }> = [];
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", CONTACT_PREFIX + "*", "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        const values = await c.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          const raw = values[i];
          if (!raw) continue;
          try {
            const stableKey = keys[i]!.slice(CONTACT_PREFIX.length);
            results.push({ key: stableKey, data: JSON.parse(raw) as CachedContact });
          } catch { /* malformed entry — skip */ }
        }
      }
    } while (cursor !== "0");
    return results;
  }, []);
}

// ── System-status API ─────────────────────────────────────────────────────────

export interface RedisSlotInfo {
  slot:       number;    // 0 = local, 1–9 = Upstash slots
  label:      string;    // "local" | "upstash-1" … "upstash-9"
  configured: boolean;
  status:     "ready" | "exhausted" | "connecting" | "disconnected" | "not_configured";
}

/** Status of the local (ephemeral) Redis client. */
export function getLocalRedisStatus(): RedisSlotInfo {
  const url = process.env["REDIS_URL"];
  if (!url) return { slot: 0, label: "local", configured: false, status: "not_configured" };
  if (!_localClient) return { slot: 0, label: "local", configured: true, status: "disconnected" };
  const s = _localClient.status;
  let status: RedisSlotInfo["status"] = "disconnected";
  if (s === "ready") status = "ready";
  else if (s === "connecting" || s === "reconnecting") status = "connecting";
  return { slot: 0, label: "local", configured: true, status };
}

/** Status of all Upstash permanent-client slots. */
export function getPermanentClientStatuses(): RedisSlotInfo[] {
  const result: RedisSlotInfo[] = [];
  for (let i = 1; i <= 9; i++) {
    const url = process.env[`REDIS_URL_${i}`];
    if (!url) break;
    const client = _permanentClients[i - 1];
    const exhausted = _quotaExhaustedSlots.has(i - 1);
    let status: RedisSlotInfo["status"] = "disconnected";
    if (!client) {
      status = "disconnected";
    } else if (exhausted) {
      status = "exhausted";
    } else {
      const s = client.status;
      if (s === "ready") status = "ready";
      else if (s === "connecting" || s === "reconnecting") status = "connecting";
      else status = "disconnected";
    }
    result.push({ slot: i, label: `upstash-${i}`, configured: true, status });
  }
  return result;
}

/** Count how many contact cache entries exist in slot 2. */
export async function contactCacheCount(): Promise<number> {
  return withContactCacheClient(async c => {
    let count = 0;
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", CONTACT_PREFIX + "*", "COUNT", 200);
      cursor = next;
      count += keys.length;
    } while (cursor !== "0");
    return count;
  }, 0);
}
