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

import { runAllChecks } from '../src/doctor/checks.js';
import { execFile } from 'child_process';

const mockedExecFile = vi.mocked(execFile);

const validStatuses: CheckStatus[] = ['pass', 'fail', 'warn'];
const validSeverities: CheckSeverity[] = ['critical', 'warning', 'info'];

beforeEach(() => {
  // 기본값: execFile 성공
  mockedExecFile.mockImplementation(
    (_cmd, _args, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '/usr/bin/mock', '');
      return {} as ReturnType<typeof execFile>;
    }
  );
});

describe('runAllChecks', () => {
  it('배열을 반환한다', async () => {
    const result = await runAllChecks();
    expect(Array.isArray(result)).toBe(true);
  });

  it('3개의 check 결과를 반환한다', async () => {
    const result = await runAllChecks();
    expect(result).toHaveLength(3);
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

  describe('claude-cli check — pass 케이스', () => {
    it('execFile 성공 시 status가 pass이고 fixSteps가 빈 배열이다', async () => {
      const result = await runAllChecks();
      const claudeCheck = result.find((c) => c.id === 'claude-cli');
      expect(claudeCheck).toBeDefined();
      expect(claudeCheck?.status).toBe('pass');
      expect(claudeCheck?.fixSteps).toEqual([]);
    });
  });

  describe('claude-cli check — fail 케이스', () => {
    it('execFile 실패 시 status가 fail이고 fixSteps가 비어있지 않다', async () => {
      mockedExecFile.mockImplementation(
        (_cmd, _args, cb: (err: Error, stdout: string, stderr: string) => void) => {
          cb(new Error('not found'), '', '');
          return {} as ReturnType<typeof execFile>;
        }
      );

      const result = await runAllChecks();
      const claudeCheck = result.find((c) => c.id === 'claude-cli');
      expect(claudeCheck).toBeDefined();
      expect(claudeCheck?.status).toBe('fail');
      expect(claudeCheck?.fixSteps.length).toBeGreaterThan(0);
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
});
