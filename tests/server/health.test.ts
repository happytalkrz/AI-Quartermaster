import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHealthRoutes } from "../../src/server/health.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

describe("createHealthRoutes", () => {
  let mockJobQueue: JobQueue;
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();

    mockJobQueue = {
      getStatus: vi.fn(),
    } as any;

    app = createHealthRoutes(mockJobQueue);
  });

  describe("GET /health", () => {
    it("should return health status with queue info", async () => {
      const mockQueueStatus = {
        running: 2,
        queued: 5,
        totalJobs: 7,
        stuckJobs: 0,
      };

      mockJobQueue.getStatus = vi.fn().mockReturnValue(mockQueueStatus);

      // Mock process methods
      const originalUptime = process.uptime;
      const originalMemoryUsage = process.memoryUsage;

      process.uptime = vi.fn().mockReturnValue(3600); // 1 hour
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 100 * 1024 * 1024,  // 100 MB
        heapUsed: 50 * 1024 * 1024, // 50 MB
        heapTotal: 80 * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 1 * 1024 * 1024,
      });

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result).toMatchObject({
        status: "ok",
        timestamp: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/),
        queue: mockQueueStatus,
        uptime: 3600,
        memory: {
          rss: 100, // MB
          heap: 50, // MB
        },
      });

      expect(mockJobQueue.getStatus).toHaveBeenCalledTimes(1);

      // Restore original methods
      process.uptime = originalUptime;
      process.memoryUsage = originalMemoryUsage;
    });

    it("should handle zero queue status", async () => {
      const mockQueueStatus = {
        running: 0,
        queued: 0,
        totalJobs: 0,
        stuckJobs: 0,
      };

      mockJobQueue.getStatus = vi.fn().mockReturnValue(mockQueueStatus);

      const originalUptime = process.uptime;
      const originalMemoryUsage = process.memoryUsage;

      process.uptime = vi.fn().mockReturnValue(0);
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
      });

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result).toMatchObject({
        status: "ok",
        queue: mockQueueStatus,
        uptime: 0,
        memory: {
          rss: 0,
          heap: 0,
        },
      });

      process.uptime = originalUptime;
      process.memoryUsage = originalMemoryUsage;
    });

    it("should round memory usage to MB", async () => {
      mockJobQueue.getStatus = vi.fn().mockReturnValue({
        running: 0,
        queued: 0,
      });

      const originalUptime = process.uptime;
      const originalMemoryUsage = process.memoryUsage;

      process.uptime = vi.fn().mockReturnValue(123.456);
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 123.7 * 1024 * 1024,    // Should round to 124 MB
        heapUsed: 45.2 * 1024 * 1024, // Should round to 45 MB
        heapTotal: 80 * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 1 * 1024 * 1024,
      });

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.memory).toEqual({
        rss: 124,
        heap: 45,
      });

      process.uptime = originalUptime;
      process.memoryUsage = originalMemoryUsage;
    });

    it("should include proper Content-Type header", async () => {
      mockJobQueue.getStatus = vi.fn().mockReturnValue({
        running: 1,
        queued: 2,
      });

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
    });

    it("should handle large queue numbers", async () => {
      const mockQueueStatus = {
        running: 999,
        queued: 1234,
        totalJobs: 2233,
        stuckJobs: 5,
      };

      mockJobQueue.getStatus = vi.fn().mockReturnValue(mockQueueStatus);

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.queue).toEqual(mockQueueStatus);
    });

    it("should work when queue status has additional fields", async () => {
      const mockQueueStatus = {
        running: 1,
        queued: 2,
        totalJobs: 3,
        stuckJobs: 0,
        extraField: "should be included",
        anotherField: 123,
      };

      mockJobQueue.getStatus = vi.fn().mockReturnValue(mockQueueStatus);

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.queue).toEqual(mockQueueStatus); // All fields should be preserved
    });

    it("should handle undefined queue status gracefully", async () => {
      mockJobQueue.getStatus = vi.fn().mockReturnValue(undefined);

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.status).toBe("ok");
      expect(result.queue).toBeUndefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.memory).toMatchObject({
        rss: expect.any(Number),
        heap: expect.any(Number),
      });
    });
  });

  describe("route mounting", () => {
    it("should return a Hono instance", () => {
      expect(app).toBeInstanceOf(Hono);
    });

    it("should not respond to other HTTP methods on /health", async () => {
      const postResponse = await app.request("/health", { method: "POST" });
      const putResponse = await app.request("/health", { method: "PUT" });
      const deleteResponse = await app.request("/health", { method: "DELETE" });

      expect(postResponse.status).toBe(404);
      expect(putResponse.status).toBe(404);
      expect(deleteResponse.status).toBe(404);
    });

    it("should not respond to unknown routes", async () => {
      const response = await app.request("/unknown");
      expect(response.status).toBe(404);
    });

    it("should handle root path correctly", async () => {
      const response = await app.request("/");
      expect(response.status).toBe(404); // No route defined for root
    });
  });

  describe("timestamp format", () => {
    it("should provide valid ISO timestamp", async () => {
      mockJobQueue.getStatus = vi.fn().mockReturnValue({});

      const beforeRequest = new Date();
      const response = await app.request("/health");
      const afterRequest = new Date();

      expect(response.status).toBe(200);
      const result = await response.json();

      const timestamp = new Date(result.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeRequest.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterRequest.getTime());

      // Should be valid ISO format
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should provide fresh timestamp on each request", async () => {
      mockJobQueue.getStatus = vi.fn().mockReturnValue({});

      const response1 = await app.request("/health");
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      const response2 = await app.request("/health");

      const result1 = await response1.json();
      const result2 = await response2.json();

      expect(result1.timestamp).not.toEqual(result2.timestamp);
    });
  });

  describe("edge cases", () => {
    it("should work with minimal queue status", async () => {
      const minimalStatus = {};
      mockJobQueue.getStatus = vi.fn().mockReturnValue(minimalStatus);

      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.status).toBe("ok");
      expect(result.queue).toEqual(minimalStatus);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.memory).toMatchObject({
        rss: expect.any(Number),
        heap: expect.any(Number),
      });
    });
  });
});