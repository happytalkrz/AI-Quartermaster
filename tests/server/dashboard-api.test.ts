import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// Mock the config loader and masker
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

// Mock imports
const mockLoadConfig = vi.mocked(await import("../../src/config/loader.js")).loadConfig;
const mockMaskSensitiveConfig = vi.mocked(await import("../../src/utils/config-masker.js")).maskSensitiveConfig;

// Mock JobStore and JobQueue
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
} as any;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
} as any;

describe("Dashboard API - /api/config", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("without API key", () => {
    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue);
    });

    it("should return config without authentication", async () => {
      const mockConfig = {
        general: { projectName: "test-project", logLevel: "info" },
        git: { defaultBaseBranch: "main" },
      };
      const mockMaskedConfig = {
        general: { projectName: "test-project", logLevel: "info" },
        git: { defaultBaseBranch: "main" },
      };

      mockLoadConfig.mockReturnValue(mockConfig as any);
      mockMaskSensitiveConfig.mockReturnValue(mockMaskedConfig);

      const response = await app.request("/api/config");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({ config: mockMaskedConfig });
      expect(mockLoadConfig).toHaveBeenCalledWith(process.cwd());
      expect(mockMaskSensitiveConfig).toHaveBeenCalledWith(mockConfig);
    });

    it("should return 500 when config loading fails", async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new Error("Config file not found");
      });

      const response = await app.request("/api/config");

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to load configuration: Config file not found");
    });
  });

  describe("with API key", () => {
    const apiKey = "test-api-key-123";

    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue, apiKey);
    });

    it("should require Bearer token authentication", async () => {
      const response = await app.request("/api/config");

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
    });

    it("should return config with valid Bearer token", async () => {
      const mockConfig = {
        general: { projectName: "test-project", logLevel: "info" },
        git: { defaultBaseBranch: "main" },
        secrets: { apiToken: "secret123", password: "secret456" },
      };
      const mockMaskedConfig = {
        general: { projectName: "test-project", logLevel: "info" },
        git: { defaultBaseBranch: "main" },
        secrets: { apiToken: "********", password: "********" },
      };

      mockLoadConfig.mockReturnValue(mockConfig as any);
      mockMaskSensitiveConfig.mockReturnValue(mockMaskedConfig);

      const response = await app.request("/api/config", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({ config: mockMaskedConfig });
      expect(mockLoadConfig).toHaveBeenCalledWith(process.cwd());
      expect(mockMaskSensitiveConfig).toHaveBeenCalledWith(mockConfig);
    });

    it("should return 401 with invalid Bearer token", async () => {
      const response = await app.request("/api/config", {
        headers: { Authorization: "Bearer invalid-token" },
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
    });

    it("should return 401 with malformed Authorization header", async () => {
      const response = await app.request("/api/config", {
        headers: { Authorization: "InvalidFormat token" },
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
    });

    it("should handle config loading errors gracefully", async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new Error("YAML parsing failed");
      });

      const response = await app.request("/api/config", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to load configuration: YAML parsing failed");
    });

    it("should handle unknown errors gracefully", async () => {
      mockLoadConfig.mockImplementation(() => {
        throw "Non-error object";
      });

      const response = await app.request("/api/config", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to load configuration: Unknown error");
    });
  });
});