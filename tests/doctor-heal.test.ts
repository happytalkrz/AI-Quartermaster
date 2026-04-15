/**
 * Doctor Heal 관련 테스트
 *
 * 다루는 범위:
 *  - GET /api/doctor/run: 정상 응답(checks 배열), 에러 처리(500)
 *  - DoctorCheck 구조: 필수 필드 + 선택적 healLevel/autoFixCommand 호환성
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { JobStore } from '../src/queue/job-store.js';
import type { JobQueue } from '../src/queue/job-queue.js';
import type { DoctorCheck } from '../src/doctor/checks.js';

// ── 공통 모킹 ─────────────────────────────────────────────────────────────────

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn(),
}));

vi.mock('../src/utils/config-masker.js', () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock('../src/config/validator.js', () => ({
  validateConfig: vi.fn(),
}));

vi.mock('../src/update/self-updater.js', () => ({
  SelfUpdater: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock('../src/store/queries.js', () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: '7d',
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: '30d', groupBy: 'project',
    summary: {
      totalCostUsd: 0, jobCount: 0, avgCostUsd: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
    },
    breakdown: [],
  }),
  getProjectSummary: vi.fn().mockReturnValue([]),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('../src/utils/cli-runner.js', () => ({
  runCli: vi.fn(),
}));

vi.mock('node-cron', () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('../src/automation/rule-engine.js', () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn(),
}));

vi.mock('../src/doctor/checks.js', () => ({
  runAllChecks: vi.fn(),
}));

// ── 동적 import (모킹 이후) ───────────────────────────────────────────────────

const { createDashboardRoutes } = await import('../src/server/dashboard-api.js');
const { runAllChecks } = await import('../src/doctor/checks.js');

const mockRunAllChecks = vi.mocked(runAllChecks);

// ── Mock 인스턴스 ─────────────────────────────────────────────────────────────

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

// ── 테스트 데이터 ─────────────────────────────────────────────────────────────

function makeCheck(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
  return {
    id: 'test-check',
    label: 'Test Check',
    severity: 'critical',
    status: 'pass',
    detail: '정상입니다.',
    fixSteps: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/doctor/run — 통합 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/doctor/run', () => {
  let app: ReturnType<typeof createDashboardRoutes>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
  });

  it('runAllChecks 성공 시 200과 checks 배열을 반환한다', async () => {
    const fakeChecks: DoctorCheck[] = [
      makeCheck({ id: 'claude-cli', label: 'Claude CLI', status: 'pass' }),
      makeCheck({ id: 'gh-cli', label: 'GitHub CLI', status: 'fail', fixSteps: ['gh 설치하세요'] }),
      makeCheck({ id: 'node-version', label: 'Node.js 버전', status: 'pass' }),
    ];
    mockRunAllChecks.mockResolvedValue(fakeChecks);

    const res = await app.request('/api/doctor/run');

    expect(res.status).toBe(200);
    const body = await res.json() as { checks: DoctorCheck[] };
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks).toHaveLength(3);
    expect(body.checks[0]).toMatchObject({ id: 'claude-cli', status: 'pass' });
    expect(body.checks[1]).toMatchObject({ id: 'gh-cli', status: 'fail' });
  });

  it('빈 checks 배열도 정상 응답한다', async () => {
    mockRunAllChecks.mockResolvedValue([]);

    const res = await app.request('/api/doctor/run');

    expect(res.status).toBe(200);
    const body = await res.json() as { checks: DoctorCheck[] };
    expect(body.checks).toEqual([]);
  });

  it('runAllChecks가 throw하면 500을 반환한다', async () => {
    mockRunAllChecks.mockRejectedValue(new Error('check execution failed'));

    const res = await app.request('/api/doctor/run');

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('응답 body에 checks 키가 존재한다', async () => {
    mockRunAllChecks.mockResolvedValue([makeCheck()]);

    const res = await app.request('/api/doctor/run');

    const body = await res.json() as Record<string, unknown>;
    expect('checks' in body).toBe(true);
  });

  it('Content-Type이 application/json이다', async () => {
    mockRunAllChecks.mockResolvedValue([]);

    const res = await app.request('/api/doctor/run');

    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DoctorCheck 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('DoctorCheck 구조', () => {
  it('pass 상태의 check는 fixSteps가 빈 배열이다', () => {
    const check = makeCheck({ status: 'pass', fixSteps: [] });
    expect(check.fixSteps).toEqual([]);
  });

  it('fail 상태의 check는 fixSteps에 항목이 있다', () => {
    const check = makeCheck({
      status: 'fail',
      fixSteps: ['step1', 'step2'],
    });
    expect(check.fixSteps.length).toBeGreaterThan(0);
  });

  it('warn 상태는 유효한 CheckStatus다', () => {
    const check = makeCheck({ status: 'warn' });
    const validStatuses = ['pass', 'fail', 'warn'];
    expect(validStatuses).toContain(check.status);
  });

  it('severity는 critical/warning/info 중 하나다', () => {
    const validSeverities = ['critical', 'warning', 'info'];
    for (const sev of validSeverities) {
      const check = makeCheck({ severity: sev as DoctorCheck['severity'] });
      expect(validSeverities).toContain(check.severity);
    }
  });

  it('docsUrl은 선택적 필드다', () => {
    const withDocs = makeCheck({ docsUrl: 'https://example.com' });
    const withoutDocs = makeCheck();
    expect(withDocs.docsUrl).toBe('https://example.com');
    expect(withoutDocs.docsUrl).toBeUndefined();
  });

  it('id와 label은 비어있지 않은 문자열이다', () => {
    const check = makeCheck({ id: 'my-check', label: 'My Check' });
    expect(check.id.length).toBeGreaterThan(0);
    expect(check.label.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runAllChecks 결과의 healLevel/autoFixCommand 필드 호환성
// (doctor.js 클라이언트에서 기대하는 선택적 필드)
// ─────────────────────────────────────────────────────────────────────────────

describe('DoctorCheck 확장 필드 (healLevel / autoFixCommand)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('healLevel이 없는 check도 정상 처리된다', async () => {
    const checks: DoctorCheck[] = [makeCheck({ status: 'fail', fixSteps: ['수동으로 설치'] })];
    mockRunAllChecks.mockResolvedValue(checks);

    const app = createDashboardRoutes(mockJobStore, mockJobQueue);
    const res = await app.request('/api/doctor/run');

    expect(res.status).toBe(200);
    const body = await res.json() as { checks: DoctorCheck[] };
    expect(body.checks[0]).not.toHaveProperty('healLevel');
  });

  it('runAllChecks가 healLevel 필드를 포함한 check를 반환하면 그대로 전달된다', async () => {
    const extendedCheck = {
      ...makeCheck({ id: 'test', status: 'fail' }),
      healLevel: 1 as const,
      autoFixCommand: 'mkdir -p ~/.config/test',
    };
    mockRunAllChecks.mockResolvedValue([extendedCheck as unknown as DoctorCheck]);

    const app = createDashboardRoutes(mockJobStore, mockJobQueue);
    const res = await app.request('/api/doctor/run');

    expect(res.status).toBe(200);
    const body = await res.json() as { checks: Array<Record<string, unknown>> };
    expect(body.checks[0]['healLevel']).toBe(1);
    expect(body.checks[0]['autoFixCommand']).toBe('mkdir -p ~/.config/test');
  });
});
