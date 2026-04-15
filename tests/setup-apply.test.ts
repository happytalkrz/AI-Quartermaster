/**
 * Setup Apply API 테스트
 *
 * 다루는 범위:
 *  - POST /api/setup/preview: wizardData → YAML 반환 검증
 *  - POST /api/setup/apply: 백업 파일 생성, 토큰 분리 저장, Zod 검증 실패 시 400
 *  - edge case: config.yml 미존재 시 신규 생성 (backupPath null)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../src/server/dashboard-api.js";
import type { JobStore } from "../src/queue/job-store.js";
import type { JobQueue } from "../src/queue/job-queue.js";

// ── 공통 모킹 ────────────────────────────────────────────────────────────────
vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn(),
  applySetupConfig: vi.fn(),
  generateSetupConfigYaml: vi.fn(),
}));

vi.mock("../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock("../src/config/validator.js", () => ({
  validateConfig: vi.fn(),
}));

vi.mock("../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn(),
}));

vi.mock("../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock("../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: "7d"
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: "30d", groupBy: "project",
    summary: {
      totalCostUsd: 0, jobCount: 0, avgCostUsd: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0
    },
    breakdown: []
  }),
  getProjectSummary: vi.fn().mockReturnValue([])
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock("../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn(),
}));

// ── Mock 인스턴스 ────────────────────────────────────────────────────────────
const loaderModule = await import("../src/config/loader.js");
const mockApplySetupConfig = vi.mocked(loaderModule.applySetupConfig);
const mockGenerateSetupConfigYaml = vi.mocked(loaderModule.generateSetupConfigYaml);

const fsModule = await import("fs");
const mockExistsSync = vi.mocked(fsModule.existsSync);
const mockReadFileSync = vi.mocked(fsModule.readFileSync);

const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({}),
} as unknown as JobStore;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
  setConcurrency: vi.fn(),
  setProjectConcurrency: vi.fn(),
} as unknown as JobQueue;

const validWizardData = {
  repo: "owner/my-repo",
  path: "/home/user/my-repo",
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setup/preview
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/setup/preview", () => {
  let app: ReturnType<typeof createDashboardRoutes>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
  });

  it("wizardData를 YAML로 직렬화하여 previewYaml을 반환한다", async () => {
    const previewYaml = "projects:\n  - repo: owner/my-repo\n    path: /home/user/my-repo\n";
    mockGenerateSetupConfigYaml.mockReturnValue(previewYaml);
    mockExistsSync.mockReturnValue(false);

    const response = await app.request("/api/setup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.previewYaml).toBe(previewYaml);
    expect(mockGenerateSetupConfigYaml).toHaveBeenCalledWith(validWizardData);
  });

  it("config.yml 존재 시 currentYaml을 함께 반환한다", async () => {
    const previewYaml = "projects:\n  - repo: owner/my-repo\n";
    const currentYaml = "projects:\n  - repo: owner/old-repo\n";
    mockGenerateSetupConfigYaml.mockReturnValue(previewYaml);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(currentYaml as unknown as Buffer);

    const response = await app.request("/api/setup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.previewYaml).toBe(previewYaml);
    expect(body.currentYaml).toBe(currentYaml);
  });

  it("config.yml 미존재 시 currentYaml이 null이다", async () => {
    mockGenerateSetupConfigYaml.mockReturnValue("projects: []\n");
    mockExistsSync.mockReturnValue(false);

    const response = await app.request("/api/setup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.currentYaml).toBeNull();
  });

  it("필수 필드(path) 누락 시 400을 반환한다", async () => {
    const response = await app.request("/api/setup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "owner/my-repo" }),
    });

    expect(response.status).toBe(400);
    expect(mockGenerateSetupConfigYaml).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setup/apply
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/setup/apply", () => {
  let app: ReturnType<typeof createDashboardRoutes>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
  });

  it("성공 시 success: true와 backupPath, credentialsWritten을 반환한다", async () => {
    const backupPath = `${process.cwd()}/config.yml.bak.1710000000000`;
    mockApplySetupConfig.mockReturnValue({
      backupPath,
      credentialsWritten: false,
      configYaml: "projects:\n  - repo: owner/my-repo\n",
    });

    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.backupPath).toBe(backupPath);
    expect(body.credentialsWritten).toBe(false);
  });

  it("기존 config.yml 존재 시 백업 파일 경로가 반환된다", async () => {
    const backupPath = `${process.cwd()}/config.yml.bak.1710000000000`;
    mockApplySetupConfig.mockReturnValue({
      backupPath,
      credentialsWritten: false,
      configYaml: "projects:\n  - repo: owner/my-repo\n",
    });

    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.backupPath).toBe(backupPath);
    expect(mockApplySetupConfig).toHaveBeenCalledWith(process.cwd(), validWizardData);
  });

  it("githubToken 포함 시 토큰이 분리 저장되어 credentialsWritten: true이다", async () => {
    mockApplySetupConfig.mockReturnValue({
      backupPath: null,
      credentialsWritten: true,
      configYaml: "projects:\n  - repo: owner/my-repo\n",
    });

    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validWizardData, githubToken: "ghp_token123" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.credentialsWritten).toBe(true);
  });

  it("config.yml 미존재 시 신규 생성 — backupPath가 null이다", async () => {
    mockApplySetupConfig.mockReturnValue({
      backupPath: null,
      credentialsWritten: false,
      configYaml: "projects:\n  - repo: owner/my-repo\n",
    });

    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.backupPath).toBeNull();
  });

  it("필수 필드(repo) 누락 시 Zod 검증 실패로 400을 반환한다", async () => {
    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/home/user/repo" }),
    });

    expect(response.status).toBe(400);
    expect(mockApplySetupConfig).not.toHaveBeenCalled();
  });

  it("applySetupConfig 내부 에러 시 500을 반환한다", async () => {
    mockApplySetupConfig.mockImplementation(() => {
      throw new Error("Zod validation failed: repo is required");
    });

    const response = await app.request("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validWizardData),
    });

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).startsWith("Setup 적용 실패")).toBe(true);
  });
});
