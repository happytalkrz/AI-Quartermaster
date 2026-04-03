import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// Mock the config loader and masker
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock("../../src/config/validator.js", () => ({
  validateConfig: vi.fn(),
}));

// Mock imports
const mockLoadConfig = vi.mocked(await import("../../src/config/loader.js")).loadConfig;
const mockAddProjectToConfig = vi.mocked(await import("../../src/config/loader.js")).addProjectToConfig;
const mockRemoveProjectFromConfig = vi.mocked(await import("../../src/config/loader.js")).removeProjectFromConfig;
const mockMaskSensitiveConfig = vi.mocked(await import("../../src/utils/config-masker.js")).maskSensitiveConfig;
const mockValidateConfig = vi.mocked(await import("../../src/config/validator.js")).validateConfig;

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

describe("Dashboard API - Projects Management", () => {
  let app: Hono;
  const apiKey = "test-api-key-123";

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue, apiKey);
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
        path: "/path/to/repo",
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
          path: "/path/to/repo",
          baseBranch: "main"
        })
      );
    });

    it("should return 409 if project already exists", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "/existing/path" }]
      };

      mockLoadConfig.mockReturnValue(projectConfig as any);

      const newProject = {
        repo: "owner/test-repo",
        path: "/path/to/repo"
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

    it("should return 400 for invalid request body", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ invalid: "data" })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toContain("repo is required");
    });

    it("should return 401 without proper authentication", async () => {
      const response = await app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "test/repo", path: "/path" })
      });

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/projects/:repo", () => {
    it("should remove an existing project successfully", async () => {
      const projectConfig = {
        general: { projectName: "test-project" },
        projects: [{ repo: "owner/test-repo", path: "/path/to/repo" }]
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
});