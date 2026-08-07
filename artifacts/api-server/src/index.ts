import app from "./app";
import { logger } from "./lib/logger";
import { connectRedis, connectPermanentRedis, disconnectRedis } from "./lib/redis";
import { coldStartRecovery } from "./lib/startup";

const rawPort = process.env["PORT"] ?? "8080";
const parsedPort = Number(rawPort);
const port = (Number.isNaN(parsedPort) || parsedPort <= 0) ? 8080 : parsedPort;

// Connect local Redis cache (non-blocking)
connectRedis()
  .then(() => logger.info("Redis connection initiated"))
  .catch((e) => logger.warn({ err: e }, "Redis connect error (non-fatal)"));

// Connect permanent Upstash Redis clients then run cold-start recovery:
//   • clears ghost active-job locks left by a killed process
//   • auto-starts ingestion if the DB is empty
connectPermanentRedis()
  .then(() =>
    coldStartRecovery().catch((e) =>
      logger.warn({ err: e }, "Cold-start recovery error (non-fatal)"),
    ),
  )
  .catch((e) => logger.warn({ err: e }, "Permanent Redis connect error (non-fatal)"));

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  // NOTE: No synthetic data seeding. Database starts empty.
  // Use POST /ingest/western-hnwi or POST /ingest/faa to load real registry data.
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close();
  await disconnectRedis();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
