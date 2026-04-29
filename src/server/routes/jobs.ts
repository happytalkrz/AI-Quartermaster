import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { JobStore, ListJobsOptions } from "../../queue/job-store.js";
import type { JobQueue } from "../../queue/job-queue.js";
import type { SSEManager } from "../sse-manager.js";
import { safeError } from "../route-context.js";
import {
  GetJobsQuerySchema,
  CancelJobRequestSchema,
  UpdateJobPriorityRequestSchema,
  RetryJobRequestSchema,
  formatZodError,
} from "../../types/api.js";
import { zodValidationHook } from "../dashboard-api.js";

export interface JobsRouteContext {
  store: JobStore;
  queue: JobQueue;
  sseManager: SSEManager;
}

/**
 * /api/jobs/* CRUD + cancel + priority + retry 라우트 등록 (Plan C #C9 — 4단계).
 *
 * 이전: dashboard-api.ts 605-705 (5 routes) + 1003-1015 (retry).
 * 비포함: /api/jobs/:id/logs/stream (SSE, sse.ts에서 처리), /api/skip-events/* (별도 도메인).
 */
export function registerJobsRoutes(api: Hono, ctx: JobsRouteContext): void {
  const { store, queue, sseManager } = ctx;

  // List all jobs (exclude archived by default, ?include=archived to show)
  api.get("/api/jobs", (c) => {
    try {
      const queryParamsForValidation = {
        project: c.req.query("project"),
        status: c.req.query("status"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
      };
      const includeArchived = c.req.query("include") === "archived";

      const parseResult = GetJobsQuerySchema.safeParse(queryParamsForValidation);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: formatZodError(parseResult.error),
        }, 400);
      }

      const { project, status, limit, offset } = parseResult.data;

      const baseOptions: ListJobsOptions = {};
      if (!includeArchived) baseOptions.excludeStatus = "archived";
      if (project) baseOptions.repo = project;

      // API status → 내부 JobStatus 매핑
      if (status === "pending") {
        baseOptions.status = "queued";
      } else if (status === "running") {
        baseOptions.status = "running";
      } else if (status === "completed") {
        baseOptions.status = "success";
      } else if (status === "failed") {
        baseOptions.statuses = ["failure", "cancelled"];
      }

      const totalJobs = store.list(baseOptions).length;
      const jobs = store.list({ ...baseOptions, limit, offset });
      const queueStatus = queue.getStatus();

      return c.json({
        jobs,
        queue: queueStatus,
        pagination: {
          total: totalJobs,
          offset: offset ?? 0,
          limit: limit ?? totalJobs,
          hasMore: (offset ?? 0) + (limit ?? totalJobs) < totalJobs,
        },
      });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch jobs");
    }
  });

  // Get single job
  api.get("/api/jobs/:id", (c) => {
    const job = store.get(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  });

  // Cancel a job
  api.post(
    "/api/jobs/:id/cancel",
    zValidator("json", CancelJobRequestSchema, zodValidationHook),
    (c) => {
      const id = c.req.param("id") ?? "";
      const cancelled = queue.cancel(id);
      if (!cancelled) return c.json({ error: "Job not found or not cancellable" }, 404);
      return c.json({ status: "cancelled", id });
    }
  );

  // Update job priority
  api.put(
    "/api/jobs/:id/priority",
    zValidator("json", UpdateJobPriorityRequestSchema, zodValidationHook),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const job = store.get(id);
      if (!job) return c.json({ error: "Job not found" }, 404);

      const { priority } = c.req.valid("json");
      const updatedJob = store.update(id, { priority });
      if (!updatedJob) return c.json({ error: "Failed to update priority" }, 500);

      sseManager.broadcast("job-updated", updatedJob);
      return c.json(updatedJob);
    }
  );

  // Delete a completed/failed job
  api.delete("/api/jobs/:id", (c) => {
    const id = c.req.param("id");
    const job = store.get(id);
    if (!job) return c.json({ error: "Job not found" }, 404);
    if (job.status === "queued" || job.status === "running") {
      return c.json({ error: "Cannot delete active job. Cancel it first." }, 400);
    }
    const deleted = store.remove(id);
    if (!deleted) return c.json({ error: "Failed to delete" }, 500);
    return c.json({ status: "deleted", id });
  });

  // Retry a failed job
  api.post(
    "/api/jobs/:id/retry",
    zValidator("json", RetryJobRequestSchema, zodValidationHook),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const job = store.get(id);
      if (!job) return c.json({ error: "Job not found" }, 404);
      if (job.status !== "failure" && job.status !== "cancelled") {
        return c.json({ error: "Only failed or cancelled jobs can be retried" }, 400);
      }
      const newJob = await queue.retryJob(id);
      if (!newJob) {
        return c.json({ error: "Failed to retry job" }, 500);
      }
      return c.json({ status: "queued", id: newJob.id });
    }
  );
}
