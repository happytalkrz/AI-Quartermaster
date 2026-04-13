import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// vi.mock() is hoisted before const declarations, so use vi.hoisted() to
// define spy refs that are available inside the mock factory.
const { mockInfo, mockWarn } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: mockInfo,
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  })),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({
  serve: vi.fn(),
}));

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
  getJobStats: vi.fn().mockReturnValue({}),
  getCostStats: vi.fn().mockReturnValue({}),
  getProjectSummary: vi.fn().mockReturnValue([]),
  getProjectStatsWithTimeRange: vi.fn().mockReturnValue([]),
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

import { Hono } from "hono";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import { startServer } from "../../src/server/webhook-server.js";
import { serve } from "@hono/node-server";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

const mockServe = vi.mocked(serve);

const emitter = new EventEmitter();
const mockStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: emitter.on.bind(emitter),
  emit: emitter.emit.bind(emitter),
  getAqDb: vi.fn().mockReturnValue({}),
  addSkipEvent: vi.fn(),
  listSkipEvents: vi.fn().mockReturnValue([]),
} as unknown as JobStore;

const mockQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
} as unknown as JobQueue;

// Helper: createDashboardRoutes without apiKey, with given hostname
function makeRoutes(hostname?: string) {
  return createDashboardRoutes(mockStore, mockQueue, undefined, undefined, hostname);
}

describe("isLocalBind detection (no API key)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs info when hostname is undefined (defaults to local)", () => {
    makeRoutes(undefined);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("accessible without authentication")
    );
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind")
    );
  });

  it("logs info when hostname is 127.0.0.1", () => {
    makeRoutes("127.0.0.1");
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("accessible without authentication")
    );
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind")
    );
  });

  it("logs info when hostname is localhost", () => {
    makeRoutes("localhost");
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("accessible without authentication")
    );
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind")
    );
  });

  it("logs warn when hostname is 0.0.0.0 (non-local)", () => {
    makeRoutes("0.0.0.0");
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind without API key is a security risk")
    );
  });

  it("logs warn when hostname is an arbitrary IP (non-local)", () => {
    makeRoutes("192.168.1.1");
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind without API key is a security risk")
    );
  });
});

describe("startServer: hostname is forwarded to serve()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServe.mockReturnValue({ close: vi.fn() } as unknown as ReturnType<typeof serve>);
  });

  it("uses 127.0.0.1 as default hostname when omitted", () => {
    const app = new Hono();
    startServer(app, 3000);
    expect(mockServe).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "127.0.0.1" })
    );
  });

  it("forwards explicit hostname 0.0.0.0 to serve()", () => {
    const app = new Hono();
    startServer(app, 3000, "0.0.0.0");
    expect(mockServe).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "0.0.0.0" })
    );
  });

  it("forwards arbitrary non-local hostname and port to serve()", () => {
    const app = new Hono();
    startServer(app, 8080, "10.0.0.5");
    expect(mockServe).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8080, hostname: "10.0.0.5" })
    );
  });
});

describe("non-local bind + no API key: security warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns with security risk message for 0.0.0.0 without API key", () => {
    makeRoutes("0.0.0.0");
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("security risk")
    );
  });

  it("does not warn for 127.0.0.1 without API key", () => {
    makeRoutes("127.0.0.1");
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("security risk")
    );
  });

  it("does not warn when API key is provided with non-local hostname", () => {
    createDashboardRoutes(mockStore, mockQueue, undefined, "secure-api-key", "0.0.0.0");
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("Non-local bind")
    );
    expect(mockWarn).not.toHaveBeenCalledWith(
      expect.stringContaining("security risk")
    );
  });
});
