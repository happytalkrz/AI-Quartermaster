/**
 * Setup Wizard API 통합 테스트
 *
 * 다루는 범위:
 *  - POST /api/setup/preview: YAML diff 생성 (신규/기존 config.yml 케이스)
 *  - POST /api/setup/apply: config.yml 저장 + 백업 생성
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// ── fs mock ──────────────────────────────────────────────────────────────────
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockCopyFileSync = vi.fn();

vi.mock("fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  statSync: vi.fn(),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
}));

// ── dependency mocks ──────────────────────────────────────────────────────────
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

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock("../../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: "7d",
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: "30d", groupBy: "project",
    summary: { totalCostUsd: 0, jobCount: 0, avgCostUsd: 0, totalInputTokens: 0,
               totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 },
    breakdown: [],
  }),
  getProjectSummary: vi.fn().mockReturnValue([]),
  getProjectStatsWithTimeRange: vi.fn().mockReturnValue(null),
  getFailureReasons: vi.fn().mockReturnValue([]),
  getThroughputTimeSeries: vi.fn().mockReturnValue([]),
  getSuccessRate: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock("../../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn(),
}));

vi.mock("../../src/config/schema-meta.js", () => ({
  getBasicFieldMetas: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/doctor/checks.js", () => ({
  runAllChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/prompt/template-renderer.js", () => ({
  loadTemplate: vi.fn().mockReturnValue(""),
  renderTemplate: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn(),
}));

// ── helpers ───────────────────────────────────────────────────────────────────
const globalEmitter = new EventEmitter();
const mockJobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({}),
} as unknown as JobStore;

const mockJobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
  setConcurrency: vi.fn(),
  setProjectConcurrency: vi.fn(),
} as unknown as JobQueue;

function makeApp() {
  return createDashboardRoutes(mockJobStore, mockJobQueue);
}

async function postJson(app: ReturnType<typeof makeApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setup/preview
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/setup/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("신규 설치 — config.yml 없는 경우 모든 라인이 added로 반환된다", async () => {
    mockExistsSync.mockReturnValue(false);

    const app = makeApp();
    const res = await postJson(app, "/api/setup/preview", {
      repo: "owner/repo",
      repoPath: "/path/to/repo",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as {
      yaml: string;
      existingYaml: null;
      diff: { added: string[]; removed: string[]; unchanged: string[] };
    };

    expect(data.existingYaml).toBeNull();
    expect(data.yaml).toContain('repo: "owner/repo"');
    expect(data.yaml).toContain('path: "/path/to/repo"');
    expect(data.diff.added.length).toBeGreaterThan(0);
    expect(data.diff.removed).toHaveLength(0);
    expect(data.diff.unchanged).toHaveLength(0);
  });

  it("기존 config.yml 있는 경우 diff가 계산된다", async () => {
    const existingYaml = `# AI Quartermaster 설정 파일\n# 전체 옵션은 docs/config-schema.md 참조\n\nprojects:\n  - repo: "old/repo"\n    path: "/old/path"\n`;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(existingYaml);

    const app = makeApp();
    const res = await postJson(app, "/api/setup/preview", {
      repo: "new/repo",
      repoPath: "/new/path",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as {
      yaml: string;
      existingYaml: string;
      diff: { added: string[]; removed: string[]; unchanged: string[] };
    };

    expect(data.existingYaml).toBe(existingYaml);
    // New repo lines should be added
    expect(data.diff.added.some((l: string) => l.includes("new/repo"))).toBe(true);
    // Old repo lines should be removed
    expect(data.diff.removed.some((l: string) => l.includes("old/repo"))).toBe(true);
    // Comment lines that appear in both should be unchanged
    expect(data.diff.unchanged.some((l: string) => l.includes("AI Quartermaster"))).toBe(true);
  });

  it("baseBranch, mode 옵션이 YAML에 포함된다", async () => {
    mockExistsSync.mockReturnValue(false);

    const app = makeApp();
    const res = await postJson(app, "/api/setup/preview", {
      repo: "owner/repo",
      repoPath: "/path/to/repo",
      baseBranch: "develop",
      mode: "polling",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { yaml: string };
    expect(data.yaml).toContain('baseBranch: "develop"');
    expect(data.yaml).toContain('mode: "polling"');
  });

  it("repo 필드 누락 시 400 반환", async () => {
    const app = makeApp();
    const res = await postJson(app, "/api/setup/preview", {
      repoPath: "/path/to/repo",
    });
    expect(res.status).toBe(400);
  });

  it("repoPath 필드 누락 시 400 반환", async () => {
    const app = makeApp();
    const res = await postJson(app, "/api/setup/preview", {
      repo: "owner/repo",
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/setup/apply
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/setup/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("신규 설치 — config.yml 없는 경우 백업 없이 파일을 생성한다", async () => {
    mockExistsSync.mockReturnValue(false);

    const app = makeApp();
    const res = await postJson(app, "/api/setup/apply", {
      repo: "owner/repo",
      repoPath: "/path/to/repo",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean; backupPath: null; configPath: string };
    expect(data.success).toBe(true);
    expect(data.backupPath).toBeNull();
    expect(data.configPath).toBeTruthy();

    // writeFileSync 호출 확인
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    // copyFileSync 호출 없음 (백업 불필요)
    expect(mockCopyFileSync).not.toHaveBeenCalled();

    // 기록된 YAML 내용 확인
    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    expect(writtenContent).toContain('repo: "owner/repo"');
    expect(writtenContent).toContain('path: "/path/to/repo"');
  });

  it("기존 config.yml 있는 경우 .bak 백업을 생성한다", async () => {
    mockExistsSync.mockReturnValue(true);

    const app = makeApp();
    const res = await postJson(app, "/api/setup/apply", {
      repo: "owner/repo",
      repoPath: "/path/to/repo",
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean; backupPath: string };
    expect(data.success).toBe(true);
    expect(data.backupPath).toMatch(/\.bak$/);

    // copyFileSync 호출 확인 (백업 생성)
    expect(mockCopyFileSync).toHaveBeenCalledOnce();
    const [src, dest] = mockCopyFileSync.mock.calls[0] as [string, string];
    expect(dest).toBe(`${src}.bak`);

    // writeFileSync 호출 확인
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("repo 필드 누락 시 400 반환", async () => {
    const app = makeApp();
    const res = await postJson(app, "/api/setup/apply", {
      repoPath: "/path/to/repo",
    });
    expect(res.status).toBe(400);
  });

  it("repoPath 필드 누락 시 400 반환", async () => {
    const app = makeApp();
    const res = await postJson(app, "/api/setup/apply", {
      repo: "owner/repo",
    });
    expect(res.status).toBe(400);
  });
});
