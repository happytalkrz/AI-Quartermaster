import { Hono } from "hono";
import type { JobQueue } from "../queue/job-queue.js";
import type { IssuePoller } from "../polling/issue-poller.js";

export function createHealthRoutes(queue: JobQueue, poller?: IssuePoller | null): Hono {
  const health = new Hono();

  health.get("/health", (c) => {
    const status = queue.getStatus();

    const pollerRunning = poller ? poller.isRunning() : null;
    const lastPollAt = poller?.getLastPollAt() ?? 0;
    const overallStatus = pollerRunning === false ? "degraded" : "ok";

    return c.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      queue: status,
      poller: {
        running: pollerRunning,
        lastPollAt: lastPollAt > 0 ? new Date(lastPollAt).toISOString() : null,
      },
      uptime: process.uptime(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  });

  return health;
}
