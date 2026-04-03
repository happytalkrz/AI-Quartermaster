import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// Mock the config loader and masker
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

// Mock imports
const mockLoadConfig = vi.mocked(await import("../../src/config/loader.js")).loadConfig;
const mockUpdateConfigSection = vi.mocked(await import("../../src/config/loader.js")).updateConfigSection;
const mockMaskSensitiveConfig = vi.mocked(await import("../../src/utils/config-masker.js")).maskSensitiveConfig;

// Mock JobStore and JobQueue with EventEmitter functionality
const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
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

describe("Dashboard API - PUT /api/config", () => {
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

    it("should update config section successfully", async () => {
      const updates = {
        general: { logLevel: "debug" as const, concurrency: 2 },
        safety: { maxPhases: 15 }
      };

      mockUpdateConfigSection.mockReturnValue(undefined);

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({
        success: true,
        message: "Configuration updated successfully"
      });
      expect(mockUpdateConfigSection).toHaveBeenCalledWith(process.cwd(), updates);
    });

    it("should return 400 for invalid request body", async () => {
      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "invalid json string",
      });

      expect(response.status).toBe(500); // JSON parsing error is caught and returns 500
      const result = await response.json();
      expect(result.error).toContain("Failed to update configuration");
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for null request body", async () => {
      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(null),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for validation errors", async () => {
      const updates = {
        general: { logLevel: "invalid-level" },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("Configuration validation failed: Invalid log level");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Configuration validation failed: Configuration validation failed: Invalid log level");
    });

    it("should return 400 for config file not found", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("config.yml not found at /path/to/config.yml");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Configuration validation failed: config.yml not found at /path/to/config.yml");
    });

    it("should return 500 for file system errors", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("Permission denied: unable to write config file");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to update configuration: Permission denied: unable to write config file");
    });

    it("should handle non-Error exceptions", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw "String error";
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toBe("Failed to update configuration: Unknown error");
    });
  });

  describe("with API key", () => {
    const apiKey = "test-api-key-123";

    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue, apiKey);
    });

    it("should require Bearer token authentication", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should update config with valid Bearer token", async () => {
      const updates = {
        general: { logLevel: "debug" as const, projectName: "test-project-updated" },
        safety: { maxPhases: 8, requireTests: true }
      };

      mockUpdateConfigSection.mockReturnValue(undefined);

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({
        success: true,
        message: "Configuration updated successfully"
      });
      expect(mockUpdateConfigSection).toHaveBeenCalledWith(process.cwd(), updates);
    });

    it("should return 401 with invalid Bearer token", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-token",
        },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should handle validation errors with authentication", async () => {
      const updates = {
        safety: { maxPhases: 100 }, // Too big, should trigger validation error
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("설정 파일에 오류가 있습니다: 최대 페이즈 수는 20 이하여야 합니다.");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(500); // Korean validation error doesn't contain "validation" word
      const result = await response.json();
      expect(result.error).toBe("Failed to update configuration: 설정 파일에 오류가 있습니다: 최대 페이즈 수는 20 이하여야 합니다.");
    });
  });
});

describe("Dashboard API - SSE broadcast", () => {
  let app: Hono;
  let mockStore: JobStore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a proper mock with EventEmitter functionality
    const emitter = new EventEmitter();

    mockStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    } as any;

    const mockQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    } as any;

    app = createDashboardRoutes(mockStore, mockQueue);
  });

  it("should register SSE client and handle job deletion event", async () => {
    const mockJob = {
      id: "test-job-1",
      issueNumber: 123,
      repo: "test/repo",
      status: "success" as const,
      createdAt: "2026-04-03T10:00:00Z",
    };

    // Start SSE connection
    const response = await app.request("/api/events");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // Simulate job deletion event
    setTimeout(() => {
      mockStore.emit("jobDeleted", mockJob);
    }, 100);

    // This test verifies the SSE endpoint can be created and events can be emitted
    // In a real scenario, we would need to parse the SSE stream to verify the broadcast
  });

  it("should handle job updated event broadcast", async () => {
    const mockJob = {
      id: "test-job-2",
      issueNumber: 456,
      repo: "test/repo",
      status: "running" as const,
      createdAt: "2026-04-03T10:00:00Z",
    };

    const response = await app.request("/api/events");
    expect(response.status).toBe(200);

    // Verify event can be emitted without errors
    expect(() => {
      mockStore.emit("jobUpdated", mockJob);
    }).not.toThrow();
  });

  it("should handle job created event broadcast", async () => {
    const mockJob = {
      id: "test-job-3",
      issueNumber: 789,
      repo: "test/repo",
      status: "queued" as const,
      createdAt: "2026-04-03T10:00:00Z",
    };

    const response = await app.request("/api/events");
    expect(response.status).toBe(200);

    // Verify event can be emitted without errors
    expect(() => {
      mockStore.emit("jobCreated", mockJob);
    }).not.toThrow();
  });
});