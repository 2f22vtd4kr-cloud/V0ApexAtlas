import { Router, type IRouter } from "express";
import { pingRedis, getRedisClient } from "../lib/redis";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const redisLatencyMs = await pingRedis();
  const redisStatus = getRedisClient()
    ? redisLatencyMs !== null
      ? "ok"
      : "error"
    : "not_connected";

  res.json({
    status: "ok",
    redis: {
      status: redisStatus,
      latencyMs: redisLatencyMs,
    },
  });
});

export default router;
