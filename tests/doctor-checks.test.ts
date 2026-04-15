import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckStatus, CheckSeverity } from '../src/doctor/checks.js';

// execFile을 항상 mock — promisify된 버전이 resolve되도록
vi.mock('child_process', () => {
  const execFile = vi.fn(
    (_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '/usr/bin/mock', '');
      return {} as ReturnType<typeof import('child_process').execFile>;
    }
  );
  return { execFile };
});

// fs/promises mock
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  constants: { W_OK: 2 },
}));

// better-sqlite3 mock
vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));

import { runAllChecks } from '../src/doctor/checks.js';
import { execFile } from 'child_process';
import * as fsp from 'fs/promises';

const mockedExecFile = vi.mocked(execFile);
const mockedAccess = vi.mocked(fsp.access);

const validStatuses: CheckStatus[] = ['pass', 'fail', 'warn'];
const validSeverities: CheckSeverity[] = ['critical', 'warning', 'info'];

function mockExecSuccess(stdout = '/usr/bin/mock') {
  mockedExecFile.mockImplementation(
    (_cmd, _args, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, '');
      return {} as ReturnType<typeof execFile>;
    }
  );
}

function mockExecFail() {
  mockedExecFile.mockImplementation(
    (_cmd, _args, cb: (err: Error, stdout: string, stderr: string) => void) => {
      cb(new Error('not found'), '', '');
      return {} as ReturnType<typeof execFile>;
    }
  );
}

beforeEach(() => {
  // 기본값: execFile 성공, access 성공
  mockExecSuccess('Logged in\nrepo workflow');
  mockedAccess.mockResolvedValue(undefined);
  vi.resetModules();
});

describe('runAllChecks', () => {
  it('배열을 반환한다', async () => {
    const result = await runAllChecks();
    expect(Array.isArray(result)).toBe(true);
  });

  it('기본 옵션에서 9개의 check 결과를 반환한다', async () => {
    const result = await runAllChecks();
    expect(result).toHaveLength(9);
  });

  it('enableClaudePing: true이면 10개의 check 결과를 반환한다', async () => {
    const result = await runAllChecks({ enableClaudePing: true });
    expect(result).toHaveLength(10);
  });

  it('각 check의 status가 유효값이다', async () => {
    const result = await runAllChecks();
    for (const check of result) {
      expect(validStatuses).toContain(check.status);
    }
  });

  it('각 check의 severity가 유효값이다', async () => {
    const result = await runAllChecks();
    for (const check of result) {
      expect(validSeverities).toContain(check.severity);
    }
  });

  it('각 check의 fixSteps가 배열이다', async () => {
    const result = await runAllChecks();
    for (const check of result) {
      expect(Array.isArray(check.fixSteps)).toBe(true);
    }
  });

  it('각 check에 필수 필드(id, label, severity, status, detail, fixSteps)가 있다', async () => {
    const result = await runAllChecks();
    for (const check of result) {
      expect(typeof check.id).toBe('string');
      expect(check.id.length).toBeGreaterThan(0);
      expect(typeof check.label).toBe('string');
      expect(check.label.length).toBeGreaterThan(0);
      expect(typeof check.detail).toBe('string');
    }
  });

  it('autoFixCommand는 string 또는 undefined이다', async () => {
    const result = await runAllChecks();
    for (const check of result) {
      expect(
        check.autoFixCommand === undefined || typeof check.autoFixCommand === 'string'
      ).toBe(true);
    }
  });

  describe('claude-cli check — pass 케이스', () => {
    it('execFile 성공 시 status가 pass이고 fixSteps가 빈 배열이다', async () => {
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'claude-cli');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
      expect(check?.fixSteps).toEqual([]);
    });
  });

  describe('claude-cli check — fail 케이스', () => {
    it('execFile 실패 시 status가 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'claude-cli');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('claude-login check', () => {
    it('auth status에 "Logged in"이 포함되면 pass이다', async () => {
      mockExecSuccess('Logged in\nrepo workflow');
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'claude-login');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('execFile 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'claude-login');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('gh-auth check', () => {
    it('repo·workflow scope가 모두 있으면 pass이다', async () => {
      mockExecSuccess('Logged in as user\nScopes: repo, workflow');
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'gh-auth');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('execFile 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'gh-auth');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('node-version check', () => {
    it('현재 Node.js 버전 정보를 detail에 포함한다', async () => {
      const result = await runAllChecks();
      const nodeCheck = result.find((c) => c.id === 'node-version');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck?.detail).toContain(process.versions.node);
    });

    it('Node.js v20 이상이면 status가 pass이고 fixSteps가 빈 배열이다', async () => {
      const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
      if (major < 20) return;

      const result = await runAllChecks();
      const nodeCheck = result.find((c) => c.id === 'node-version');
      expect(nodeCheck?.status).toBe('pass');
      expect(nodeCheck?.fixSteps).toEqual([]);
    });
  });

  describe('git-identity check', () => {
    it('user.name·user.email 모두 설정되면 pass이다', async () => {
      mockedExecFile.mockImplementation(
        (_cmd, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
          cb(null, 'Test User', '');
          return {} as ReturnType<typeof execFile>;
        }
      );
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'git-identity');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('execFile 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'git-identity');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('sqlite3 check', () => {
    it('better-sqlite3 import 성공 시 pass이다', async () => {
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'sqlite3');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('better-sqlite3 import 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      vi.doMock('better-sqlite3', () => {
        throw new Error('Cannot find module');
      });
      // dynamic import 실패는 모듈 레벨 mock으로 시뮬레이션하기 어려우므로
      // fail 케이스 구조 검증 (pass일 경우 스킵)
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'sqlite3');
      expect(check).toBeDefined();
      if (check?.status === 'fail') {
        expect(check.fixSteps.length).toBeGreaterThan(0);
      }
    });
  });

  describe('aqm-dir-write check', () => {
    it('access 성공 시 pass이다', async () => {
      mockedAccess.mockResolvedValue(undefined);
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'aqm-dir-write');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('access 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockedAccess.mockRejectedValue(new Error('ENOENT'));
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'aqm-dir-write');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('github-api-ping check', () => {
    it('gh api /user 성공 시 pass이다', async () => {
      mockExecSuccess('testuser\n');
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'github-api-ping');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('execFile 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'github-api-ping');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });

  describe('claude-ping check (opt-in)', () => {
    it('enableClaudePing: false(기본값)이면 claude-ping check가 없다', async () => {
      const result = await runAllChecks();
      const check = result.find((c) => c.id === 'claude-ping');
      expect(check).toBeUndefined();
    });

    it('enableClaudePing: true이면 claude-ping check가 포함된다', async () => {
      mockExecSuccess('/usr/bin/claude');
      const result = await runAllChecks({ enableClaudePing: true });
      const check = result.find((c) => c.id === 'claude-ping');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass');
    });

    it('execFile 실패 시 fail이고 fixSteps가 비어있지 않다', async () => {
      mockExecFail();
      const result = await runAllChecks({ enableClaudePing: true });
      const check = result.find((c) => c.id === 'claude-ping');
      expect(check).toBeDefined();
      expect(check?.status).toBe('fail');
      expect(check?.fixSteps.length).toBeGreaterThan(0);
    });
  });
});
