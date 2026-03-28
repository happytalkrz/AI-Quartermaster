import { Hono } from "hono";
import type { JobQueue } from "../queue/job-queue.js";

export function createHealthRoutes(queue: JobQueue): Hono {
  const health = new Hono();

  health.get("/health", (c) => {
    const status = queue.getStatus();

    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      queue: status,
      uptime: process.uptime(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  });

  return health;
}
