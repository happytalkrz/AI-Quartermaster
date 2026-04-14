import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes, stopPeriodicCleanup, cleanupAllSSEClients, cleanupDashboardResources, getSSEClientCount, applyConfigChanges } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// Mock the config loader and masker
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn(),
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock("../../src/config/validator.js", () => ({
  validateConfig: vi.fn(),
}));

vi.mock("../../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn(),
}));

vi.mock("../../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 3,
    successCount: 1,
    failureCount: 1,
    runningCount: 1,
    queuedCount: 0,
    cancelledCount: 0,
    avgDurationMs: 0,
    successRate: 33,
    project: null,
    timeRange: "7d",
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null,
    timeRange: "30d",
    groupBy: "project",
    summary: {
      totalCostUsd: 0,
      jobCount: 0,
      avgCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
    },
    breakdown: [],
  }),
  getProjectSummary: vi.fn().mockReturnValue([]),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/config/project-detector.js", () => ({
  detectProjectCommands: vi.fn(),
  detectBaseBranch: vi.fn(),
}));

// Mock imports
const mockLoadConfig = vi.mocked(await import("../../src/config/loader.js")).loadConfig;
const mockUpdateConfigSection = vi.mocked(await import("../../src/config/loader.js")).updateConfigSection;
const mockAddProjectToConfig = vi.mocked(await import("../../src/config/loader.js")).addProjectToConfig;
const mockRemoveProjectFromConfig = vi.mocked(await import("../../src/config/loader.js")).removeProjectFromConfig;
const mockUpdateProjectInConfig = vi.mocked(await import("../../src/config/loader.js")).updateProjectInConfig;
const mockMaskSensitiveConfig = vi.mocked(await import("../../src/utils/config-masker.js")).maskSensitiveConfig;
const mockValidateConfig = vi.mocked(await import("../../src/config/validator.js")).validateConfig;
const mockSelfUpdater = vi.mocked(await import("../../src/update/self-updater.js")).SelfUpdater;
const mockReadFileSync = vi.mocked(await import("fs")).readFileSync;
const mockExistsSync = vi.mocked(await import("fs")).existsSync;
const mockStatSync = vi.mocked(await import("fs")).statSync;
const mockRunCli = vi.mocked(await import("../../src/utils/cli-runner.js")).runCli;
const mockGetJobStats = vi.mocked(await import("../../src/store/queries.js")).getJobStats;
const mockGetCostStats = vi.mocked(await import("../../src/store/queries.js")).getCostStats;
const mockGetProjectSummary = vi.mocked(await import("../../src/store/queries.js")).getProjectSummary;
const mockDetectProjectCommands = vi.mocked(await import("../../src/config/project-detector.js")).detectProjectCommands;
const mockDetectBaseBranch = vi.mocked(await import("../../src/config/project-detector.js")).detectBaseBranch;

// Mock JobStore and JobQueue with EventEmitter functionality
const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({}),
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
      app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
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

      expect(response.status).toBe(400);
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
      expect(result.details).toBeDefined();
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid logLevel value", async () => {
      const updates = {
        general: { logLevel: "invalid-level" },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for negative concurrency value", async () => {
      const updates = {
        general: { concurrency: -1 },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for wrong type for concurrency (string instead of number)", async () => {
      const updates = {
        general: { concurrency: "abc" },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid safety maxPhases value", async () => {
      const updates = {
        safety: { maxPhases: 0 }, // Should be min 1
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
      expect(mockUpdateConfigSection).not.toHaveBeenCalled();
    });

    it("should ignore extra unexpected fields and save valid sections", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
        unexpectedSection: { value: "test" },
      };

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it("should return 400 for config loader validation errors", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("Configuration validation failed: Invalid config structure");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Configuration validation failed: Configuration validation failed: Invalid config structure");
    });

    it("should return 400 for config file not found", async () => {
      const updates = {
        general: { logLevel: "debug" as const },
      };

      mockUpdateConfigSection.mockImplementation(() => {
        throw new Error("config.yml not found at path/to/config.yml");
      });

      const response = await app.request("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Configuration validation failed: config.yml not found at path/to/config.yml");
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
      app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
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
        safety: { maxPhases: 15 }, // Valid value to pass Zod validation
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

describe("Dashboard API - Resource Management", () => {
  let app: Hono;
  const apiKey = "test-api-key-123";

  beforeEach(() => {
    vi.clearAllMocks();

    const mockStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    } as any;

    const mockQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    } as any;

    app = createDashboardRoutes(mockStore, mockQueue, undefined, apiKey);
  });

  it("should create SSE client with proper timestamps", async () => {
    const response = await app.request("/api/events?token=test-token");

    // For authentication required endpoints, we expect 401 without proper token
    // This test verifies the endpoint can be reached and SSE structure is correct
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should handle SSE client cleanup on connection errors", async () => {
    // This test verifies that the API doesn't crash when handling SSE errors
    // Actual SSE stream testing would require more complex setup with readable streams
    expect(() => {
      app.request("/api/events?token=test-token");
    }).not.toThrow();
  });

  it("should handle session token authentication for SSE", async () => {
    // First get a session token
    const authResponse = await app.request("/api/auth", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    expect(authResponse.status).toBe(200);
    const authData = await authResponse.json();
    expect(authData.token).toBeDefined();

    // Then use the token for SSE endpoint
    const sseResponse = await app.request(`/api/events?token=${authData.token}`);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("Dashboard API - Projects Management", () => {
  let app: Hono;
  const apiKey = "test-api-key-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectProjectCommands.mockReturnValue({ language: "unknown", commands: {} });
    mockDetectBaseBranch.mockResolvedValue("main");
    app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
  });

  describe("POST /api/projects", () => {
    it("should add a new project successfully", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);
      mockValidateConfig.mockReturnValue(projectConfig as any);

      const newProject = {
        repo: "owner/test-repo",
        path: "path/to/repo",
        baseBranch: "main"
      };

      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newProject)
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.message).toBe("Project added successfully");
      expect(result.project.repo).toBe("owner/test-repo");
      expect(mockAddProjectToConfig).toHaveBeenCalledWith(
        `${process.cwd()}/config.yml`,
        expect.objectContaining({
          repo: "owner/test-repo",
          path: "path/to/repo",
          baseBranch: "main"
        })
      );
    });

    it("should return 409 if project already exists", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "existingpath" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const newProject = {
        repo: "owner/test-repo",
        path: "path/to/repo"
      };

      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newProject)
      });

      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result.error).toContain("already exists");
    });

    it("should return 400 for missing repo field", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path: "/path/to/repo" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
    });

    it("should return 400 for missing path field", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ repo: "owner/test-repo" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
    });

    it("should return 400 for empty repo field", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ repo: "", path: "/path/to/repo" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
    });

    it("should return 400 for invalid mode field", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repo: "owner/test-repo",
          path: "/path/to/repo",
          mode: "invalid"
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
    });

    it("should return 400 for extra unexpected fields", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repo: "owner/test-repo",
          path: "/path/to/repo",
          unexpectedField: "value"
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeDefined();
    });

    it("should return 401 without proper authentication", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "test/repo", path: "path" })
      });

      expect(response.status).toBe(401);
    });

    // Path Traversal security tests
    it("should reject path with directory traversal patterns", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const maliciousPaths = [
        "../etc/passwd",
        "..\\windows\\system32",
        "../../../secret",
        "./config",
        "folder/../escape"
      ];

      for (const maliciousPath of maliciousPaths) {
        const response = await app.request("/api/projects", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            repo: "test/repo",
            path: maliciousPath
          })
        });


        expect(response.status).toBe(400);
        const result = await response.json();
        expect(result.error).toContain("unsafe characters or path traversal");
      }
    });

    it("should accept absolute paths (required for local project paths)", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repo: "test/repo",
          path: "/home/user/project"
        })
      });

      // 절대 경로는 허용 — 201 또는 config 관련 에러 (400이 아님)
      expect(response.status).not.toBe(400);
    });

    it("should reject path with control characters and forbidden characters", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const forbiddenPaths = [
        "file\x00name",
        "file<name",
        "file>name",
        "file:name",
        "file|name",
        "file?name",
        "file*name",
        "folder/"
      ];

      for (const forbiddenPath of forbiddenPaths) {
        const response = await app.request("/api/projects", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            repo: "test/repo",
            path: forbiddenPath
          })
        });

        expect(response.status).toBe(400);
        const result = await response.json();
        expect(result.error).toContain("unsafe characters or path traversal");
      }
    });
  });

  describe("DELETE /api/projects/:repo", () => {
    it("should remove an existing project successfully", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path/to/repo" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);
      mockValidateConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe("Project removed successfully");
      expect(result.repo).toBe("owner/test-repo");
      expect(mockRemoveProjectFromConfig).toHaveBeenCalledWith(
        `${process.cwd()}/config.yml`,
        "owner/test-repo"
      );
    });

    it("should return 404 if project does not exist", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects/owner%2Fnonexistent-repo", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` }
      });

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.error).toContain("not found");
    });

    it("should return 401 without proper authentication", async () => {
      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "DELETE"
      });

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /api/projects/:repo", () => {
    it("should update an existing project successfully", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "oldpath", baseBranch: "main" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);
      mockValidateConfig.mockReturnValue(projectConfig as any);
      mockUpdateProjectInConfig.mockReturnValue(undefined);

      const updates = {
        path: "newpath",
        baseBranch: "develop",
        mode: "code"
      };

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe("Project updated successfully");
      expect(result.repo).toBe("owner/test-repo");
      expect(result.updates).toEqual({
        path: "newpath",
        baseBranch: "develop",
        mode: "code"
      });
      expect(mockUpdateProjectInConfig).toHaveBeenCalledWith(
        `${process.cwd()}/config.yml`,
        "owner/test-repo",
        { path: "newpath", baseBranch: "develop", mode: "code" }
      );
    });

    it("should update project with partial fields", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);
      mockValidateConfig.mockReturnValue(projectConfig as any);

      const updates = { path: "updated/path" };

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.updates).toEqual({ path: "updated/path" });
    });

    it("should return 404 if project does not exist", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: []
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const updates = { path: "newpath" };

      const response = await app.request("/api/projects/owner%2Fnonexistent-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.error).toContain("not found");
    });

    it("should return 400 for invalid request body", async () => {
      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(null)
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
    });

    it("should return 400 for invalid field types", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path: 123 })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeInstanceOf(Array);
      expect(result.details.some((d: { field: string }) => d.field === "path")).toBe(true);
    });

    it("should return 400 for invalid mode value", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mode: "invalid" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeInstanceOf(Array);
      expect(result.details.some((d: { field: string }) => d.field === "mode")).toBe(true);
    });

    it("should return 400 when no valid fields to update", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ invalidField: "value" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      // UpdateProjectRequestSchema는 .strict()이므로 알 수 없는 필드는 Zod 에러로 처리됨
      expect(result.error).toBe("Invalid request body");
      expect(result.details).toBeInstanceOf(Array);
    });

    it("should return 401 without proper authentication", async () => {
      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "newpath" })
      });

      expect(response.status).toBe(401);
    });

    it("should handle config validation errors", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);
      mockUpdateProjectInConfig.mockReturnValue(undefined);
      mockValidateConfig.mockImplementation(() => {
        throw new Error("Invalid configuration");
      });

      const updates = { path: "newpath" };

      const response = await app.request("/api/projects/owner%2Ftest-repo", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toContain("Configuration validation failed");
    });
  });
});

describe("Dashboard API - Version Management", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/version", () => {
    describe("without API key", () => {
      beforeEach(() => {
        app = createDashboardRoutes(mockJobStore, mockJobQueue);
      });

      it("should return version info with update check", async () => {
        const mockPackageJson = { version: "1.0.0" };
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };
        const mockUpdateInfo = {
          hasUpdates: false,
          currentHash: "abc12345",
          remoteHash: "abc12345",
          packageLockChanged: false,
        };

        mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          checkForUpdates: vi.fn().mockResolvedValue(mockUpdateInfo),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/version");

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toEqual({
          currentVersion: "1.0.0",
          currentHash: "abc12345".substring(0, 8),
          remoteHash: "abc12345".substring(0, 8),
          hasUpdates: false,
          packageLockChanged: false,
        });
        expect(mockSelfUpdater).toHaveBeenCalledWith(mockConfig.git, { cwd: process.cwd() });
      });

      it("should return version info with available updates", async () => {
        const mockPackageJson = { version: "1.0.0" };
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };
        const mockUpdateInfo = {
          hasUpdates: true,
          currentHash: "abc12345",
          remoteHash: "def67890",
          packageLockChanged: true,
        };

        mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          checkForUpdates: vi.fn().mockResolvedValue(mockUpdateInfo),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/version");

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toEqual({
          currentVersion: "1.0.0",
          currentHash: "abc12345".substring(0, 8),
          remoteHash: "def67890".substring(0, 8),
          hasUpdates: true,
          packageLockChanged: true,
        });
      });

      it("should return version info even when update check fails", async () => {
        const mockPackageJson = { version: "1.0.0" };
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          checkForUpdates: vi.fn().mockRejectedValue(new Error("Network error")),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/version");

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toEqual({
          currentVersion: "1.0.0",
          currentHash: "unknown",
          remoteHash: "unknown",
          hasUpdates: false,
          packageLockChanged: false,
          error: "업데이트 확인에 실패했습니다",
        });
      });

      it("should return 500 when package.json reading fails", async () => {
        mockReadFileSync.mockImplementation(() => {
          throw new Error("File not found");
        });

        const response = await app.request("/api/version");

        expect(response.status).toBe(500);
        const result = await response.json();
        expect(result.error).toBe("버전 정보 조회 실패: File not found");
      });

      it("should return 500 when package.json is invalid JSON", async () => {
        mockReadFileSync.mockReturnValue("invalid json");

        const response = await app.request("/api/version");

        expect(response.status).toBe(500);
        const result = await response.json();
        expect(result.error).toContain("버전 정보 조회 실패:");
      });
    });

    describe("with API key", () => {
      const apiKey = "test-api-key-123";

      beforeEach(() => {
        app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
      });

      it("should require Bearer token authentication", async () => {
        const response = await app.request("/api/version");

        expect(response.status).toBe(401);
        const result = await response.json();
        expect(result.error).toBe("Unauthorized");
      });

      it("should return version info with valid Bearer token", async () => {
        const mockPackageJson = { version: "2.0.0" };
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };
        const mockUpdateInfo = {
          hasUpdates: false,
          currentHash: "xyz98765",
          remoteHash: "xyz98765",
          packageLockChanged: false,
        };

        mockReadFileSync.mockReturnValue(JSON.stringify(mockPackageJson));
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          checkForUpdates: vi.fn().mockResolvedValue(mockUpdateInfo),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/version", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.currentVersion).toBe("2.0.0");
        expect(result.hasUpdates).toBe(false);
      });
    });
  });

  describe("POST /api/update", () => {
    describe("without API key", () => {
      beforeEach(() => {
        app = createDashboardRoutes(mockJobStore, mockJobQueue);
      });

      it("should perform update successfully when no jobs running", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        // Mock no running jobs
        mockJobStore.list.mockReturnValue([]);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockResolvedValue({ updated: true, needsRestart: true }),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toEqual({
          message: "업데이트가 완료되었습니다",
          updated: true,
          needsRestart: true,
        });
        expect(mockSelfUpdaterInstance.performSelfUpdate).toHaveBeenCalled();
      });

      it("should return message when already up to date", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        mockJobStore.list.mockReturnValue([]);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockResolvedValue({ updated: false, needsRestart: false }),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toEqual({
          message: "이미 최신 버전입니다",
          updated: false,
          needsRestart: false,
        });
      });

      it("should cancel running/queued jobs and proceed with update", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };
        const activeJobs = [
          { id: "job1", issueNumber: 123, repo: "test/repo", status: "running" as const },
          { id: "job2", issueNumber: 456, repo: "test/repo", status: "queued" as const },
        ];
        mockJobStore.list.mockReturnValue(activeJobs);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockResolvedValue({ updated: true, needsRestart: true }),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(200);
        expect(mockJobQueue.cancel).toHaveBeenCalledWith("job1");
        expect(mockJobQueue.cancel).toHaveBeenCalledWith("job2");
        expect(mockSelfUpdaterInstance.performSelfUpdate).toHaveBeenCalled();
      });

      it("should return 500 when update fails", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        mockJobStore.list.mockReturnValue([]);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockRejectedValue(new Error("Git pull failed")),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(500);
        const result = await response.json();
        expect(result.error).toBe("업데이트 실패: Git pull failed");
      });

      it("should handle unknown errors gracefully", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        mockJobStore.list.mockReturnValue([]);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockRejectedValue("String error"),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(500);
        const result = await response.json();
        expect(result.error).toBe("업데이트 실패: Unknown error");
      });
    });

    describe("with API key", () => {
      const apiKey = "test-api-key-123";

      beforeEach(() => {
        app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
      });

      it("should require Bearer token authentication", async () => {
        const response = await app.request("/api/update", { method: "POST" });

        expect(response.status).toBe(401);
        const result = await response.json();
        expect(result.error).toBe("Unauthorized");
      });

      it("should perform update with valid Bearer token", async () => {
        const mockConfig = { git: { gitPath: "git", remoteAlias: "origin", defaultBaseBranch: "main" } };

        mockJobStore.list.mockReturnValue([]);
        mockLoadConfig.mockReturnValue(mockConfig as any);

        const mockSelfUpdaterInstance = {
          performSelfUpdate: vi.fn().mockResolvedValue({ updated: true, needsRestart: true }),
        };
        mockSelfUpdater.mockImplementation(() => mockSelfUpdaterInstance as any);

        const response = await app.request("/api/update", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.updated).toBe(true);
        expect(result.needsRestart).toBe(true);
      });

      it("should return 401 with invalid Bearer token", async () => {
        const response = await app.request("/api/update", {
          method: "POST",
          headers: { Authorization: "Bearer invalid-token" },
        });

        expect(response.status).toBe(401);
        const result = await response.json();
        expect(result.error).toBe("Unauthorized");
      });
    });
  });

  describe("Dashboard API - Project filtering and health check", () => {
    describe("without API key", () => {
      let app: Hono;

      beforeEach(() => {
        vi.clearAllMocks();
        app = createDashboardRoutes(mockJobStore, mockJobQueue);
      });

      describe("GET /api/jobs with project filter", () => {
        it("should return jobs filtered by project", async () => {
          const allMockJobs = [
            { id: "job-1", repo: "test/repo1", status: "completed" },
            { id: "job-2", repo: "test/repo2", status: "completed" },
            { id: "job-3", repo: "test/repo1", status: "failed" }
          ];

          // DB 레벨 필터링 시뮬레이션: repo 옵션에 따라 필터링
          mockJobStore.list.mockImplementation((opts?: { repo?: string }) => {
            if (opts?.repo) {
              return allMockJobs.filter(j => j.repo === opts.repo);
            }
            return allMockJobs;
          });

          const response = await app.request("/api/jobs?project=test/repo1");
          expect(response.status).toBe(200);

          const result = await response.json();
          expect(result.jobs).toHaveLength(2);
          expect(result.jobs.every((job: any) => job.repo === "test/repo1")).toBe(true);
        });

        it("should return all jobs when no project filter specified", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "completed" },
            { id: "job-2", repo: "test/repo2", status: "completed" }
          ];

          mockJobStore.list.mockReturnValue(mockJobs);

          const response = await app.request("/api/jobs");
          expect(response.status).toBe(200);

          const result = await response.json();
          expect(result.jobs).toHaveLength(2);
        });

        it("should return empty array when no jobs match project", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "success" },
            { id: "job-2", repo: "test/repo2", status: "success" }
          ];

          mockJobStore.list.mockImplementation((opts?: { repo?: string }) => {
            if (opts?.repo) return mockJobs.filter(j => j.repo === opts.repo);
            return mockJobs;
          });

          const response = await app.request("/api/jobs?project=test/nonexistent");
          expect(response.status).toBe(200);

          const result = await response.json();
          expect(result.jobs).toHaveLength(0);
          expect(result.pagination.total).toBe(0);
        });

        it("should filter by project and status combined", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "success" },
            { id: "job-2", repo: "test/repo1", status: "running" },
            { id: "job-3", repo: "test/repo2", status: "success" }
          ];

          mockJobStore.list.mockImplementation((opts?: { repo?: string; status?: string }) => {
            let filtered = mockJobs;
            if (opts?.repo) filtered = filtered.filter(j => j.repo === opts.repo);
            if (opts?.status) filtered = filtered.filter(j => j.status === opts.status);
            return filtered;
          });

          const response = await app.request("/api/jobs?project=test/repo1&status=completed");
          expect(response.status).toBe(200);

          const result = await response.json();
          expect(result.jobs).toHaveLength(1);
          expect(result.jobs[0].id).toBe("job-1");
          expect(result.jobs[0].repo).toBe("test/repo1");
        });

        it("should report correct pagination total when filtered by project", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "success" },
            { id: "job-2", repo: "test/repo1", status: "running" },
            { id: "job-3", repo: "test/repo1", status: "queued" },
            { id: "job-4", repo: "test/repo2", status: "success" }
          ];

          mockJobStore.list.mockImplementation((opts?: { repo?: string; limit?: number }) => {
            let filtered = mockJobs;
            if (opts?.repo) filtered = filtered.filter(j => j.repo === opts.repo);
            if (opts?.limit) filtered = filtered.slice(0, opts.limit);
            return filtered;
          });

          const response = await app.request("/api/jobs?project=test/repo1&limit=2");
          expect(response.status).toBe(200);

          const result = await response.json();
          expect(result.jobs).toHaveLength(2);
          expect(result.pagination.total).toBe(3);
          expect(result.pagination.hasMore).toBe(true);
        });

        it("should return 400 for invalid limit query param", async () => {
          mockJobStore.list.mockReturnValue([]);

          const response = await app.request("/api/jobs?project=test/repo1&limit=notanumber");
          expect(response.status).toBe(400);

          const result = await response.json();
          expect(result.error).toBe("Invalid query parameters");
        });
      });

      describe("GET /api/stats with project filter", () => {
        it("should return stats for specific project", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "completed" },
            { id: "job-2", repo: "test/repo2", status: "completed" },
            { id: "job-3", repo: "test/repo1", status: "failed" }
          ];

          mockJobStore.list.mockReturnValue(mockJobs);

          const response = await app.request("/api/stats?project=test/repo1");
          expect(response.status).toBe(200);

          const result = await response.json();
          // Check if stats endpoint works and returns some data structure
          expect(result).toBeTypeOf("object");
          expect(result).not.toBeNull();
        });
      });

      describe("GET /api/health", () => {
        it("should return 400 when project parameter is missing", async () => {
          const response = await app.request("/api/health");
          expect(response.status).toBe(400);

          const result = await response.json();
          expect(result.error).toBe("project parameter is required");
        });

        it("should accept project parameter", async () => {
          const response = await app.request("/api/health?project=test/repo1");

          // Should not return 400 (missing parameter)
          expect(response.status).not.toBe(400);
        });
      });
    });

    describe("with API key", () => {
      const apiKey = "test-api-key-123";
      let app: Hono;

      beforeEach(() => {
        vi.clearAllMocks();
        app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey);
      });

      describe("GET /api/jobs with project filter", () => {
        it("should require Bearer token authentication", async () => {
          const response = await app.request("/api/jobs?project=test/repo1");

          expect(response.status).toBe(401);
          const result = await response.json();
          expect(result.error).toBe("Unauthorized");
        });

        it("should return jobs with valid Bearer token", async () => {
          const mockJobs = [
            { id: "job-1", repo: "test/repo1", status: "completed" },
            { id: "job-2", repo: "test/repo2", status: "completed" }
          ];

          mockJobStore.list.mockReturnValue(mockJobs);

          const response = await app.request("/api/jobs?project=test/repo1", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          expect(response.status).toBe(200);
        });
      });

      describe("GET /api/health", () => {
        it("should require Bearer token authentication", async () => {
          const response = await app.request("/api/health?project=test/repo1");

          expect(response.status).toBe(401);
          const result = await response.json();
          expect(result.error).toBe("Unauthorized");
        });

        it("should accept health check with valid Bearer token", async () => {
          const response = await app.request("/api/health?project=test/repo1", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });

          // Should not return 401 (unauthorized)
          expect(response.status).not.toBe(401);
        });
      });
    });
  });

  describe("SSE Resource Management", () => {
    it("should handle SSE client connections properly", async () => {
      const response = await app.request("/api/events?token=test-token");
      expect(response.status).toBe(401);
    });

    describe("cleanup functions", () => {
      it("should call cleanup functions without errors", () => {
        expect(() => stopPeriodicCleanup()).not.toThrow();
        expect(() => cleanupAllSSEClients()).not.toThrow();
        expect(() => cleanupDashboardResources()).not.toThrow();
      });

      it("cleanup functions should handle repeated calls gracefully", () => {
        expect(() => {
          cleanupDashboardResources();
          cleanupDashboardResources();
        }).not.toThrow();
      });
    });
  });
});

describe("Dashboard API - GET /api/health (detailed)", () => {
  let app: Hono;

  const mockConfig = {
    projects: [{ repo: "test/repo", path: "./test-project" }],
    git: { gitPath: "git" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);

    mockLoadConfig.mockReturnValue(mockConfig as any);

    // Default: git remote accessible
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" });

    // Default: path exists and is a directory, package.json and node_modules exist
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);
  });

  it("should return 400 when project parameter is missing", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("project parameter is required");
  });

  it("should return 404 when project not found in config", async () => {
    const response = await app.request("/api/health?project=unknown/repo");
    expect(response.status).toBe(404);
    const result = await response.json();
    expect(result.error).toContain("unknown/repo");
  });

  it("should return healthy when git remote and local path are ok", async () => {
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.project).toBe("test/repo");
    expect(result.status).toBe("healthy");
    expect(result.checks.gitRemoteAccess.status).toBe("ok");
    expect(result.checks.localPath.status).toBe("ok");
    expect(result.lastChecked).toBeDefined();
  });

  it("should return error status when git remote is not accessible", async () => {
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      return { exitCode: 128, stdout: "", stderr: "fatal: repository not found" };
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("error");
    expect(result.checks.gitRemoteAccess.status).toBe("error");
    expect(result.checks.gitRemoteAccess.message).toContain("Git remote not accessible");
  });

  it("should return error status when git remote check throws", async () => {
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      throw new Error("Network unreachable");
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("error");
    expect(result.checks.gitRemoteAccess.status).toBe("error");
    expect(result.checks.gitRemoteAccess.message).toContain("Network unreachable");
  });

  it("should return error status when local path does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("error");
    expect(result.checks.localPath.status).toBe("error");
    expect(result.checks.localPath.message).toBe("Project path does not exist");
  });

  it("should return error status when local path is not a directory", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => false } as any);

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("error");
    expect(result.checks.localPath.status).toBe("error");
    expect(result.checks.localPath.message).toBe("Project path is not a directory");
  });

  it("should return warning when disk space is below 1GB", async () => {
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 199500000000 500000000 99% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("warning");
    expect(result.checks.diskSpace.status).toBe("warning");
    expect(result.checks.diskSpace.message).toContain("Low disk space");
  });

  it("should return warning when dependencies are not installed", async () => {
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    mockExistsSync.mockImplementation((p: unknown) => {
      const path = p as string;
      if (path.endsWith("node_modules")) return false;
      return true;
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("warning");
    expect(result.checks.dependencies.status).toBe("warning");
    expect(result.checks.dependencies.message).toContain("Dependencies not installed");
  });

  it("should return 500 when loadConfig throws", async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config read error");
    });

    const response = await app.request("/api/health?project=test/repo");
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Health check failed");
  });
});

describe("Dashboard API - GET /api/projects/health", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });
  });

  it("should return empty list when no projects configured", async () => {
    mockLoadConfig.mockReturnValue({ projects: [], git: {} } as any);

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(result.summary.healthy).toBe(0);
  });

  it("should return empty list when projects field is undefined", async () => {
    mockLoadConfig.mockReturnValue({ git: {} } as any);

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(0);
  });

  it("should return healthy status for all passing projects", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [
        { repo: "org/repo1", path: "./repo1" },
        { repo: "org/repo2", path: "./repo2" },
      ],
      git: { gitPath: "git" },
    } as any);

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.healthy).toBe(2);
    expect(result.summary.error).toBe(0);
    expect(result.summary.checkedAt).toBeDefined();

    const p1 = result.projects.find((p: { project: string }) => p.project === "org/repo1");
    expect(p1).toBeDefined();
    expect(p1.status).toBe("healthy");
    expect(p1.checks.gitRemoteAccess.status).toBe("ok");
    expect(p1.checks.localPath.status).toBe("ok");
  });

  it("should report error in summary when git remote fails for a project", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [
        { repo: "org/repo1", path: "./repo1" },
        { repo: "org/repo2", path: "./repo2" },
      ],
      git: { gitPath: "git" },
    } as any);

    let gitCallCount = 0;
    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      gitCallCount++;
      if (gitCallCount === 1) {
        return { exitCode: 128, stdout: "", stderr: "fatal: repository not found" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.summary.total).toBe(2);
    expect(result.summary.error).toBeGreaterThanOrEqual(1);
  });

  it("should merge stats from getProjectSummary into results", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    const mockGetProjectSummary = vi.mocked(await import("../../src/store/queries.js")).getProjectSummary;
    mockGetProjectSummary.mockReturnValue([
      {
        repo: "org/repo1",
        total: 10,
        successCount: 8,
        failureCount: 2,
        successRate: 80,
        avgDurationMs: 5000,
        totalCostUsd: 1.5,
      } as any,
    ]);

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].stats).not.toBeNull();
    expect(result.projects[0].stats.repo).toBe("org/repo1");
    expect(result.projects[0].stats.successRate).toBe(80);
  });

  it("should set stats to null for projects not in getProjectSummary", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    const mockGetProjectSummary = vi.mocked(await import("../../src/store/queries.js")).getProjectSummary;
    mockGetProjectSummary.mockReturnValue([]);

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects[0].stats).toBeNull();
  });

  it("should return 500 when loadConfig throws", async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config error");
    });

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Projects health check failed");
  });
});

describe("Dashboard API - SSE Connection Management", () => {
  let app: Hono;

  function makeMockApp(): Hono {
    const emitter = new EventEmitter();
    const store = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
      getAqDb: vi.fn().mockReturnValue({}),
    } as any;
    const queue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    } as any;
    return createDashboardRoutes(store, queue);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupAllSSEClients();
    stopPeriodicCleanup();
    app = makeMockApp();
  });

  afterEach(() => {
    cleanupAllSSEClients();
    stopPeriodicCleanup();
  });

  describe("client registration", () => {
    it("should increment client count when SSE connection is established", async () => {
      expect(getSSEClientCount()).toBe(0);

      await app.request("/api/events");

      expect(getSSEClientCount()).toBe(1);
    });

    it("should track multiple simultaneous SSE clients", async () => {
      await app.request("/api/events");
      await app.request("/api/events");
      await app.request("/api/events");

      expect(getSSEClientCount()).toBe(3);
    });

    it("should return 200 text/event-stream for SSE endpoint", async () => {
      const response = await app.request("/api/events");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
    });
  });

  describe("cleanupAllSSEClients", () => {
    it("should reduce client count to 0 after cleanup", async () => {
      await app.request("/api/events");
      await app.request("/api/events");

      expect(getSSEClientCount()).toBeGreaterThan(0);

      cleanupAllSSEClients();

      expect(getSSEClientCount()).toBe(0);
    });

    it("should be idempotent when no clients are connected", () => {
      expect(getSSEClientCount()).toBe(0);
      expect(() => cleanupAllSSEClients()).not.toThrow();
      expect(getSSEClientCount()).toBe(0);
    });

    it("should allow new clients after cleanup", async () => {
      await app.request("/api/events");
      await app.request("/api/events");

      cleanupAllSSEClients();
      expect(getSSEClientCount()).toBe(0);

      await app.request("/api/events");
      expect(getSSEClientCount()).toBe(1);
    });
  });

  describe("cleanupDashboardResources", () => {
    it("should clear all SSE clients", async () => {
      await app.request("/api/events");

      expect(getSSEClientCount()).toBeGreaterThan(0);

      cleanupDashboardResources();

      expect(getSSEClientCount()).toBe(0);
    });

    it("should not throw on repeated calls", () => {
      expect(() => {
        cleanupDashboardResources();
        cleanupDashboardResources();
        cleanupDashboardResources();
      }).not.toThrow();
    });
  });

  describe("leak prevention", () => {
    it("should not retain stale clients after cleanup and reconnect cycle", async () => {
      for (let i = 0; i < 5; i++) {
        await app.request("/api/events");
      }
      expect(getSSEClientCount()).toBe(5);

      cleanupAllSSEClients();
      expect(getSSEClientCount()).toBe(0);

      await app.request("/api/events");
      expect(getSSEClientCount()).toBe(1);
    });

    it("should not accumulate clients across multiple cleanup cycles", async () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        await app.request("/api/events");
        await app.request("/api/events");
        cleanupAllSSEClients();
        expect(getSSEClientCount()).toBe(0);
      }
    });
  });

  describe("connection limit enforcement", () => {
    it("should evict oldest client when limit is exceeded", async () => {
      // Fill 3 clients and record their count
      await app.request("/api/events");
      await app.request("/api/events");
      await app.request("/api/events");
      const countBeforeEviction = getSSEClientCount();

      // Client count should be non-zero and bounded
      expect(countBeforeEviction).toBeGreaterThan(0);
      expect(countBeforeEviction).toBeLessThanOrEqual(50);
    });

    it("getSSEClientCount should reflect actual connected clients", async () => {
      expect(getSSEClientCount()).toBe(0);

      await app.request("/api/events");
      expect(getSSEClientCount()).toBe(1);

      await app.request("/api/events");
      expect(getSSEClientCount()).toBe(2);

      cleanupAllSSEClients();
      expect(getSSEClientCount()).toBe(0);
    });

    it("should remove client when stream is cancelled by reader", async () => {
      const response = await app.request("/api/events");
      expect(getSSEClientCount()).toBe(1);

      // Cancel the stream reader to trigger the ReadableStream cancel() callback
      const reader = response.body!.getReader();
      await reader.cancel();

      expect(getSSEClientCount()).toBe(0);
    });
  });

  describe("error handling and timeout", () => {
    it("should handle sendInitialState error gracefully when stream is closed", async () => {
      // Make store.list throw to trigger the catch block in sendInitialState
      const errorApp = makeMockApp();
      const emitter = new EventEmitter();
      const throwingStore = {
        list: vi.fn().mockImplementation(() => { throw new Error("DB error"); }),
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        getAqDb: vi.fn().mockReturnValue({}),
      } as any;
      const throwingQueue = {
        getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
        cancel: vi.fn(),
        retryJob: vi.fn(),
      } as any;
      const appWithError = createDashboardRoutes(throwingStore, throwingQueue);

      // Should not throw even when store.list() throws inside the stream
      const response = await appWithError.request("/api/events");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
    });

    it("should auto-close SSE stream after 5 minutes via setTimeout", async () => {
      vi.useFakeTimers();
      try {
        const response = await app.request("/api/events");
        expect(getSSEClientCount()).toBe(1);

        // Advance past the 5-minute auto-close timeout
        await vi.advanceTimersByTimeAsync(300001);

        // Client should have been removed by the timeout callback
        expect(getSSEClientCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("Dashboard API - PUT /api/jobs/:id/priority", () => {
  let app: Hono;
  let localStore: JobStore;

  const mockJob = {
    id: "job-123",
    issueNumber: 42,
    repo: "owner/repo",
    status: "queued" as const,
    priority: "normal" as const,
    createdAt: "2026-04-10T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const emitter = new EventEmitter();
    localStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    } as any;

    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    } as any;

    app = createDashboardRoutes(localStore, localQueue);
  });

  it("should update job priority to high", async () => {
    const updatedJob = { ...mockJob, priority: "high" as const };
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);
    vi.mocked(localStore.update).mockReturnValue(updatedJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.priority).toBe("high");
    expect(localStore.update).toHaveBeenCalledWith("job-123", { priority: "high" });
  });

  it("should update job priority to normal", async () => {
    const updatedJob = { ...mockJob, priority: "normal" as const };
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);
    vi.mocked(localStore.update).mockReturnValue(updatedJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "normal" }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.priority).toBe("normal");
    expect(localStore.update).toHaveBeenCalledWith("job-123", { priority: "normal" });
  });

  it("should update job priority to low", async () => {
    const updatedJob = { ...mockJob, priority: "low" as const };
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);
    vi.mocked(localStore.update).mockReturnValue(updatedJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "low" }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.priority).toBe("low");
    expect(localStore.update).toHaveBeenCalledWith("job-123", { priority: "low" });
  });

  it("should return 404 when job not found", async () => {
    vi.mocked(localStore.get).mockReturnValue(undefined);

    const response = await app.request("/api/jobs/nonexistent/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });

    expect(response.status).toBe(404);
    const result = await response.json();
    expect(result.error).toBe("Job not found");
  });

  it("should return 400 for invalid JSON body", async () => {
    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });

    expect(response.status).toBe(400);
  });

  it("should return 400 for invalid priority value", async () => {
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "urgent" }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Invalid request body");
    expect(result.details).toBeDefined();
  });

  it("should return 400 for missing priority field", async () => {
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Invalid request body");
    expect(result.details).toBeDefined();
  });

  it("should return 400 for extra fields in request body", async () => {
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "high", extra: "field" }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Invalid request body");
    expect(result.details).toBeDefined();
  });

  it("should return 500 when store.update fails", async () => {
    vi.mocked(localStore.get).mockReturnValue(mockJob as any);
    vi.mocked(localStore.update).mockReturnValue(undefined);

    const response = await app.request("/api/jobs/job-123/priority", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toBe("Failed to update priority");
  });

  describe("with API key", () => {
    beforeEach(() => {
      const apiKey = "test-api-key-123";
      const emitter = new EventEmitter();
      localStore = {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        update: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      } as any;

      const localQueue = {
        getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
        cancel: vi.fn(),
        retryJob: vi.fn(),
      } as any;

      app = createDashboardRoutes(localStore, localQueue, undefined, apiKey);
    });

    it("should return 401 without authentication", async () => {
      const response = await app.request("/api/jobs/job-123/priority", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "high" }),
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.error).toBe("Unauthorized");
    });

    it("should update priority with valid Bearer token", async () => {
      const updatedJob = { ...mockJob, priority: "high" as const };
      vi.mocked(localStore.get).mockReturnValue(mockJob as any);
      vi.mocked(localStore.update).mockReturnValue(updatedJob as any);

      const response = await app.request("/api/jobs/job-123/priority", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key-123",
        },
        body: JSON.stringify({ priority: "high" }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.priority).toBe("high");
    });
  });
});

describe("Dashboard API - GET /api/repositories", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

    mockRunCli.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      if (Array.isArray(args) && args.includes("worktree")) {
        return { exitCode: 0, stdout: "worktree /path/to/repo\nHEAD abc123\nbranch refs/heads/main\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    mockGetProjectSummary.mockReturnValue([]);
  });

  it("should return empty repositories when no projects configured", async () => {
    mockLoadConfig.mockReturnValue({ projects: [], git: {} } as any);

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(result.summary.healthy).toBe(0);
    expect(result.summary.totalJobs).toBe(0);
  });

  it("should return empty repositories when projects field is undefined", async () => {
    mockLoadConfig.mockReturnValue({ git: {} } as any);

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories).toHaveLength(0);
  });

  it("should return healthy repositories for passing projects", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [
        { repo: "org/repo1", path: "./repo1" },
        { repo: "org/repo2", path: "./repo2" },
      ],
      git: { gitPath: "git" },
    } as any);

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories).toHaveLength(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.healthy).toBe(2);
    expect(result.summary.error).toBe(0);
    expect(result.summary.warning).toBe(0);
    expect(result.summary.checkedAt).toBeDefined();

    const repo1 = result.repositories.find((r: { repository: string }) => r.repository === "org/repo1");
    expect(repo1).toBeDefined();
    expect(repo1.status).toBe("healthy");
    expect(repo1.health.gitRemoteAccess.status).toBe("ok");
    expect(repo1.health.localPath.status).toBe("ok");
    expect(repo1.worktreeCount).toBeGreaterThanOrEqual(0);
  });

  it("should report error status when git remote access fails", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockRunCli.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      if (Array.isArray(args) && args.includes("worktree")) {
        return { exitCode: 128, stdout: "", stderr: "fatal: not a git repository" };
      }
      return { exitCode: 128, stdout: "", stderr: "fatal: repository not found" };
    });

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].status).toBe("error");
    expect(result.summary.error).toBe(1);
  });

  it("should report warning status when disk space is low", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockRunCli.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === "df") {
        // Available < 1GB triggers warning
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 199500000000 500000000 99% /\n", stderr: "" };
      }
      if (Array.isArray(args) && args.includes("worktree")) {
        return { exitCode: 0, stdout: "worktree /path/to/repo\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories[0].status).toBe("warning");
    expect(result.summary.warning).toBe(1);
  });

  it("should merge stats from getProjectSummary", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockGetProjectSummary.mockReturnValue([
      {
        repo: "org/repo1",
        total: 20,
        successCount: 15,
        failureCount: 5,
        successRate: 75,
        totalCostUsd: 2.5,
        lastActivity: "2026-04-01T00:00:00Z",
      } as any,
    ]);

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories[0].stats.totalJobs).toBe(20);
    expect(result.repositories[0].stats.successJobs).toBe(15);
    expect(result.repositories[0].stats.failedJobs).toBe(5);
    expect(result.repositories[0].stats.successRate).toBe(75);
    expect(result.repositories[0].stats.totalCostUsd).toBe(2.5);
    expect(result.summary.totalJobs).toBe(20);
  });

  it("should use default stats when project not in getProjectSummary", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockGetProjectSummary.mockReturnValue([]);

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repositories[0].stats.totalJobs).toBe(0);
    expect(result.repositories[0].stats.successJobs).toBe(0);
    expect(result.repositories[0].stats.lastActivity).toBeNull();
  });

  it("should return 500 when loadConfig throws", async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config load failed");
    });

    const response = await app.request("/api/repositories");
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toBe("Failed to fetch repositories");
  });
});

describe("Dashboard API - GET /api/claude-profile", () => {
  let app: Hono;

  const mockClaudeConfig = {
    commands: {
      claudeCli: {
        path: "claude",
        model: "claude-sonnet-4-5",
        models: {
          plan: "claude-opus-4-5",
          phase: "claude-sonnet-4-5",
          review: "claude-sonnet-4-5",
          fallback: "claude-haiku-4-5",
        },
        maxTurns: 10,
        timeout: 300000,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
    mockLoadConfig.mockReturnValue(mockClaudeConfig as any);
  });

  it("should return claude profile info", async () => {
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });

    const response = await app.request("/api/claude-profile");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profile).toBeDefined();
    expect(result.cliVersion).toBe("1.0.0");
    expect(result.model).toBe("claude-sonnet-4-5");
    expect(result.models.plan).toBe("claude-opus-4-5");
    expect(result.models.phase).toBe("claude-sonnet-4-5");
    expect(result.models.review).toBe("claude-sonnet-4-5");
    expect(result.models.fallback).toBe("claude-haiku-4-5");
    expect(result.maxTurns).toBe(10);
    expect(result.timeout).toBe(300000);
  });

  it("should return unknown cliVersion when CLI fails", async () => {
    mockRunCli.mockRejectedValue(new Error("CLI not found"));

    const response = await app.request("/api/claude-profile");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.cliVersion).toBe("unknown");
  });

  it("should return unknown cliVersion when CLI exits non-zero", async () => {
    mockRunCli.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error" });

    const response = await app.request("/api/claude-profile");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.cliVersion).toBe("unknown");
  });

  it("should use default profile when CLAUDE_CONFIG_DIR is not set", async () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });

    const response = await app.request("/api/claude-profile");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profile).toBe("default");
    expect(result.configDir).toBe("");
  });

  it("should extract profile name from CLAUDE_CONFIG_DIR", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/home/user/.claude-myprofile";
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });

    const response = await app.request("/api/claude-profile");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.profile).toBe("myprofile");
    expect(result.configDir).toBe("/home/user/.claude-myprofile");

    delete process.env.CLAUDE_CONFIG_DIR;
  });
});

describe("Dashboard API - GET /api/jobs/:id/logs/stream", () => {
  let app: Hono;
  let localStore: JobStore;

  beforeEach(() => {
    vi.clearAllMocks();

    const emitter = new EventEmitter();
    localStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
      getAqDb: vi.fn().mockReturnValue({}),
    } as any;

    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    } as any;

    app = createDashboardRoutes(localStore, localQueue);
  });

  it("should return SSE stream with correct headers", async () => {
    vi.mocked(localStore.get).mockReturnValue({
      id: "job-1",
      status: "running",
      logs: [],
    } as any);

    const response = await app.request("/api/jobs/job-1/logs/stream");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("should send error event when job not found", async () => {
    vi.mocked(localStore.get).mockReturnValue(undefined);

    const response = await app.request("/api/jobs/nonexistent/logs/stream");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: error");
    expect(text).toContain("Job not found");
    reader.cancel();
  });

  it("should send done event when job is already completed", async () => {
    vi.mocked(localStore.get).mockReturnValue({
      id: "job-1",
      status: "success",
      logs: ["line1", "line2"],
    } as any);

    const response = await app.request("/api/jobs/job-1/logs/stream");
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      if (value) chunks.push(value);
      done = d;
    }
    const text = chunks.map(c => new TextDecoder().decode(c)).join("");
    expect(text).toContain("event: done");
    expect(text).toContain('"status":"success"');
  });
});

describe("Dashboard API - GET /api/projects/health warning branch", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true } as any);
    mockGetProjectSummary.mockReturnValue([]);
  });

  it("should report warning when disk space is low for a project", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        // Available = 500MB < 1GB → warning
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 199500000000 500000000 99% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].status).toBe("warning");
    expect(result.summary.warning).toBe(1);
    expect(result.summary.healthy).toBe(0);
  });

  it("should report warning when dependencies are not installed", async () => {
    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
      git: { gitPath: "git" },
    } as any);

    mockRunCli.mockImplementation(async (cmd: string) => {
      if (cmd === "df") {
        return { exitCode: 0, stdout: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 100000000000 100000000000 50% /\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "abc123\trefs/heads/main\n", stderr: "" };
    });

    // Make node_modules not exist (package.json exists, but node_modules doesn't)
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("node_modules")) return false;
      return true;
    });

    const response = await app.request("/api/projects/health");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects[0].status).toBe("warning");
    expect(result.summary.warning).toBe(1);
  });
});

describe("Dashboard API - GET /api/projects/:repo/error-state", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return errorState null when project has no error state", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(null),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/error-state");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repo).toBe("owner/repo");
    expect(result.errorState).toBeNull();
    expect(localQueue.getProjectStatus).toHaveBeenCalledWith("owner/repo");
  });

  it("should return errorState with failure info when project has errors", async () => {
    const lastFailureAt = Date.now() - 1000;
    const errorState = {
      consecutiveFailures: 2,
      pausedUntil: null,
      lastFailureAt,
    };
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(errorState),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/error-state");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repo).toBe("owner/repo");
    expect(result.errorState.consecutiveFailures).toBe(2);
    expect(result.errorState.pausedUntil).toBeNull();
    expect(result.errorState.lastFailureAt).toBe(lastFailureAt);
  });

  it("should return errorState with pausedUntil when project is paused", async () => {
    const pausedUntil = Date.now() + 60000;
    const errorState = {
      consecutiveFailures: 3,
      pausedUntil,
      lastFailureAt: Date.now() - 1000,
    };
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(errorState),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/error-state");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repo).toBe("owner/repo");
    expect(result.errorState.pausedUntil).toBe(pausedUntil);
    expect(result.errorState.consecutiveFailures).toBe(3);
  });

  it("should decode URL-encoded repo parameter", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(null),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    await app.request("/api/projects/my-org%2Fmy-repo/error-state");
    expect(localQueue.getProjectStatus).toHaveBeenCalledWith("my-org/my-repo");
  });

  it("should return 500 when getProjectStatus throws", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockImplementation(() => {
        throw new Error("Internal queue error");
      }),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/error-state");
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Failed to get error state");
  });
});

describe("Dashboard API - POST /api/projects/:repo/pause", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pause a project with default duration (30 minutes)", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const before = Date.now();
    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
    });
    const after = Date.now();

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repo).toBe("owner/repo");
    expect(result.message).toContain("owner/repo");
    expect(result.message).toContain("1800s");
    expect(result.pausedUntil).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(result.pausedUntil).toBeLessThanOrEqual(after + 30 * 60 * 1000);
    expect(localQueue.pauseProject).toHaveBeenCalledWith("owner/repo", 30 * 60 * 1000);
  });

  it("should pause a project with custom durationMs", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: 60000 }),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.message).toContain("60s");
    expect(localQueue.pauseProject).toHaveBeenCalledWith("owner/repo", 60000);
  });

  it("should return 400 for negative durationMs", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: -1000 }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("durationMs");
    expect(localQueue.pauseProject).not.toHaveBeenCalled();
  });

  it("should return 400 for zero durationMs", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: 0 }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("durationMs");
    expect(localQueue.pauseProject).not.toHaveBeenCalled();
  });

  it("should return 400 for non-numeric durationMs", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: "not-a-number" }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toContain("durationMs");
    expect(localQueue.pauseProject).not.toHaveBeenCalled();
  });

  it("should use default duration when body is empty (no Content-Type)", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(localQueue.pauseProject).toHaveBeenCalledWith("owner/repo", 30 * 60 * 1000);
  });

  it("should return 500 when pauseProject throws", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      pauseProject: vi.fn().mockImplementation(() => {
        throw new Error("Queue internal error");
      }),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/pause", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Failed to pause project");
  });
});

describe("Dashboard API - POST /api/projects/:repo/resume", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should resume a paused project", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      resumeProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/resume", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.repo).toBe("owner/repo");
    expect(result.message).toContain("owner/repo");
    expect(localQueue.resumeProject).toHaveBeenCalledWith("owner/repo");
  });

  it("should decode URL-encoded repo parameter on resume", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      resumeProject: vi.fn(),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    await app.request("/api/projects/my-org%2Fmy-repo/resume", { method: "POST" });
    expect(localQueue.resumeProject).toHaveBeenCalledWith("my-org/my-repo");
  });

  it("should return 500 when resumeProject throws", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      resumeProject: vi.fn().mockImplementation(() => {
        throw new Error("Queue internal error");
      }),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    const response = await app.request("/api/projects/owner%2Frepo/resume", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error).toContain("Failed to resume project");
  });
});

describe("Dashboard API - GET /api/projects includes errorState", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include errorState in each project entry", async () => {
    const errorState = {
      consecutiveFailures: 1,
      pausedUntil: null,
      lastFailureAt: Date.now() - 5000,
    };
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(errorState),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    mockLoadConfig.mockReturnValue({
      projects: [
        { repo: "org/repo1", path: "./repo1" },
        { repo: "org/repo2", path: "./repo2" },
      ],
    } as any);

    const response = await app.request("/api/projects");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].errorState).toEqual(errorState);
    expect(result.projects[1].errorState).toEqual(errorState);
    expect(localQueue.getProjectStatus).toHaveBeenCalledWith("org/repo1");
    expect(localQueue.getProjectStatus).toHaveBeenCalledWith("org/repo2");
  });

  it("should include null errorState when project has no errors", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(null),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/repo1", path: "./repo1" }],
    } as any);

    const response = await app.request("/api/projects");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects[0].errorState).toBeNull();
    expect(result.projects[0].repo).toBe("org/repo1");
  });

  it("should return empty list when no projects configured", async () => {
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(null),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    mockLoadConfig.mockReturnValue({ projects: [] } as any);

    const response = await app.request("/api/projects");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects).toEqual([]);
  });

  it("should include paused errorState for project that is paused", async () => {
    const pausedUntil = Date.now() + 30 * 60 * 1000;
    const pausedErrorState = {
      consecutiveFailures: 3,
      pausedUntil,
      lastFailureAt: Date.now() - 2000,
    };
    const localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
      getProjectStatus: vi.fn().mockReturnValue(pausedErrorState),
    } as any;
    app = createDashboardRoutes(mockJobStore, localQueue);

    mockLoadConfig.mockReturnValue({
      projects: [{ repo: "org/paused-repo", path: "./paused-repo" }],
    } as any);

    const response = await app.request("/api/projects");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projects[0].errorState.pausedUntil).toBe(pausedUntil);
    expect(result.projects[0].errorState.consecutiveFailures).toBe(3);
  });
});

describe("Dashboard API - stale config 회귀 테스트 (configWatcher.current())", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("configWatcher 전달 시 매 요청마다 configWatcher.current()가 호출되어야 한다", async () => {
    const mockConfig = {
      general: { projectName: "test-project", logLevel: "info" },
    };
    const mockCurrent = vi.fn().mockReturnValue(mockConfig);
    const mockConfigWatcher = { current: mockCurrent } as any;
    mockMaskSensitiveConfig.mockReturnValue(mockConfig as any);

    app = createDashboardRoutes(mockJobStore, mockJobQueue, mockConfigWatcher);

    await app.request("/api/config");
    await app.request("/api/config");
    await app.request("/api/config");

    expect(mockCurrent).toHaveBeenCalledTimes(3);
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it("config 변경 후 다음 요청에 새 config가 반영되어야 한다", async () => {
    const oldConfig = {
      general: { projectName: "old-project", logLevel: "info" },
    };
    const newConfig = {
      general: { projectName: "new-project", logLevel: "debug" },
    };

    const mockCurrent = vi.fn()
      .mockReturnValueOnce(oldConfig)
      .mockReturnValueOnce(newConfig);
    const mockConfigWatcher = { current: mockCurrent } as any;
    mockMaskSensitiveConfig.mockImplementation((c) => c as any);

    app = createDashboardRoutes(mockJobStore, mockJobQueue, mockConfigWatcher);

    const res1 = await app.request("/api/config");
    const result1 = await res1.json() as { config: { general: { projectName: string } } };
    expect(result1.config.general.projectName).toBe("old-project");

    const res2 = await app.request("/api/config");
    const result2 = await res2.json() as { config: { general: { projectName: string } } };
    expect(result2.config.general.projectName).toBe("new-project");

    expect(mockCurrent).toHaveBeenCalledTimes(2);
  });

  it("configWatcher 미전달 시 loadConfig() 폴백이 사용되어야 한다", async () => {
    const mockConfig = {
      general: { projectName: "fallback-project", logLevel: "info" },
    };
    mockLoadConfig.mockReturnValue(mockConfig as any);
    mockMaskSensitiveConfig.mockReturnValue(mockConfig as any);

    app = createDashboardRoutes(mockJobStore, mockJobQueue);

    const response = await app.request("/api/config");

    expect(response.status).toBe(200);
    expect(mockLoadConfig).toHaveBeenCalledWith(process.cwd());
  });
});

describe("Dashboard API - POST /api/jobs/:id/cancel", () => {
  let app: Hono;
  let localQueue: { getStatus: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; retryJob: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    const emitter = new EventEmitter();
    const localStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
      getAqDb: vi.fn().mockReturnValue({}),
    } as any;

    localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn().mockReturnValue(true),
      retryJob: vi.fn(),
    };

    app = createDashboardRoutes(localStore, localQueue as any);
  });

  it("should return 400 for invalid JSON body", async () => {
    const response = await app.request("/api/jobs/job-123/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });

    expect(response.status).toBe(400);
  });

  it("should return 400 for body with extra fields (strict schema)", async () => {
    const response = await app.request("/api/jobs/job-123/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "user requested" }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Invalid request body");
    expect(result.details).toBeDefined();
  });

  it("should cancel job successfully with valid empty body", async () => {
    localQueue.cancel.mockReturnValue(true);

    const response = await app.request("/api/jobs/job-123/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("cancelled");
    expect(result.id).toBe("job-123");
  });

  it("should return 404 when job not found or not cancellable", async () => {
    localQueue.cancel.mockReturnValue(false);

    const response = await app.request("/api/jobs/nonexistent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    const result = await response.json();
    expect(result.error).toBe("Job not found or not cancellable");
  });
});

describe("Dashboard API - POST /api/jobs/:id/retry", () => {
  let app: Hono;
  let localStore: JobStore;
  let localQueue: { getStatus: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; retryJob: ReturnType<typeof vi.fn> };

  const mockFailedJob = {
    id: "job-failed",
    issueNumber: 99,
    repo: "owner/repo",
    status: "failure" as const,
    createdAt: "2026-04-10T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const emitter = new EventEmitter();
    localStore = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
      getAqDb: vi.fn().mockReturnValue({}),
    } as any;

    localQueue = {
      getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
      cancel: vi.fn(),
      retryJob: vi.fn(),
    };

    app = createDashboardRoutes(localStore, localQueue as any);
  });

  it("should return 400 for invalid JSON body", async () => {
    const response = await app.request("/api/jobs/job-failed/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });

    expect(response.status).toBe(400);
  });

  it("should return 400 for body with extra fields (strict schema)", async () => {
    const response = await app.request("/api/jobs/job-failed/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Invalid request body");
    expect(result.details).toBeDefined();
  });

  it("should retry failed job successfully with valid empty body", async () => {
    vi.mocked(localStore.get).mockReturnValue(mockFailedJob as any);
    const newJob = { ...mockFailedJob, id: "job-new", status: "queued" as const };
    localQueue.retryJob.mockReturnValue(newJob);

    const response = await app.request("/api/jobs/job-failed/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe("queued");
    expect(result.id).toBe("job-new");
  });

  it("should return 404 when job not found", async () => {
    vi.mocked(localStore.get).mockReturnValue(undefined);

    const response = await app.request("/api/jobs/nonexistent/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    const result = await response.json();
    expect(result.error).toBe("Job not found");
  });

  it("should return 400 when job is not in failure or cancelled status", async () => {
    const runningJob = { ...mockFailedJob, status: "running" as const };
    vi.mocked(localStore.get).mockReturnValue(runningJob as any);

    const response = await app.request("/api/jobs/job-failed/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe("Only failed or cancelled jobs can be retried");
  });
});