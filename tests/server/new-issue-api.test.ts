import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { loadTemplate, renderTemplate } from "../../src/prompt/template-renderer.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn()
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn()
}));

vi.mock("../../src/config/validator.js", () => ({
  validateConfig: vi.fn()
}));

vi.mock("../../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn()
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  setGlobalLogLevel: vi.fn()
}));

vi.mock("../../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: "7d"
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: "30d", groupBy: "project",
    summary: { totalCostUsd: 0, jobCount: 0, avgCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 },
    breakdown: []
  }),
  getProjectSummary: vi.fn().mockReturnValue([])
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn()
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn()
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() })
}));

vi.mock("../../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn()
}));

vi.mock("../../src/prompt/template-renderer.js", () => ({
  loadTemplate: vi.fn().mockReturnValue("template {{what}}"),
  renderTemplate: vi.fn().mockReturnValue("rendered body")
}));

const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({})
} as unknown as JobStore;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
  setConcurrency: vi.fn(),
  setProjectConcurrency: vi.fn()
} as unknown as JobQueue;

const mockRunCli = vi.mocked(runCli);
const mockLoadTemplate = vi.mocked(loadTemplate);
const mockRenderTemplate = vi.mocked(renderTemplate);

const validBody = {
  category: "bug",
  title: "Login fails on timeout",
  repo: "owner/repo",
  what: "User session expires mid-login",
  where: "src/auth/login.ts",
  how: "Check token expiry handling",
  files: "src/auth/login.ts"
};

describe("POST /api/new-issue", () => {
  let app: ReturnType<typeof createDashboardRoutes>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
    mockLoadTemplate.mockReturnValue("template {{what}}");
    mockRenderTemplate.mockReturnValue("rendered body");
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "https://github.com/owner/repo/issues/42\n", stderr: "" });
  });

  it("유효한 요청 시 이슈 URL과 번호를 반환한다", async () => {
    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { url: string; number: number };
    expect(result.url).toBe("https://github.com/owner/repo/issues/42");
    expect(result.number).toBe(42);
  });

  it("gh CLI에 올바른 인수를 전달한다", async () => {
    await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });

    expect(mockRunCli).toHaveBeenCalledWith("gh", [
      "issue", "create",
      "--repo", "owner/repo",
      "--title", "Login fails on timeout",
      "--body", "rendered body",
      "--label", "aqm-by"
    ]);
  });

  it("category에 맞는 템플릿을 로드하고 변수를 렌더링한다", async () => {
    await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });

    expect(mockLoadTemplate).toHaveBeenCalledWith(
      expect.stringContaining("bug.md"),
      expect.stringContaining("issue-templates")
    );
    expect(mockRenderTemplate).toHaveBeenCalledWith(
      "template {{what}}",
      expect.objectContaining({
        what: validBody.what,
        where: validBody.where,
        how: validBody.how,
        files: validBody.files
      })
    );
  });

  it("feature category로 요청 시 feature.md 템플릿을 로드한다", async () => {
    await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, category: "feature" })
    });

    expect(mockLoadTemplate).toHaveBeenCalledWith(
      expect.stringContaining("feature.md"),
      expect.stringContaining("issue-templates")
    );
  });

  it("title 누락 시 400을 반환한다", async () => {
    const { title: _t, ...body } = validBody;
    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(400);
  });

  it("잘못된 category 값 시 400을 반환한다", async () => {
    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, category: "invalid" })
    });
    expect(response.status).toBe(400);
  });

  it("what 누락 시 400을 반환한다", async () => {
    const { what: _w, ...body } = validBody;
    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(400);
  });

  it("gh CLI 실패 시 500을 반환한다", async () => {
    mockRunCli.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "authentication failed" });

    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });
    expect(response.status).toBe(500);
  });

  it("이슈 URL에서 번호를 파싱할 수 없는 경우 number가 undefined다", async () => {
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "https://github.com/owner/repo/issues\n", stderr: "" });

    const response = await app.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { url: string; number?: number };
    expect(result.number).toBeUndefined();
  });

  it("readOnly 모드에서 POST 요청을 403으로 거부한다", async () => {
    const readOnlyApp = createDashboardRoutes(
      mockJobStore, mockJobQueue,
      undefined, undefined, undefined, undefined, true
    );

    const response = await readOnlyApp.request("/api/new-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody)
    });
    expect(response.status).toBe(403);
  });
});
