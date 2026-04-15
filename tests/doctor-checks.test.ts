import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/cli-runner.js', () => ({
  runCli: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({
  default: class Database {},
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    accessSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'linux'),
  };
});

import { runCli } from '../src/utils/cli-runner.js';
import * as fsModule from 'fs';
import {
  checkClaudeCli,
  checkClaudeLogin,
  checkGhCli,
  checkGhAuth,
  checkGitIdentity,
  checkNodeVersion,
  checkSqliteNative,
  checkAqmWritable,
  checkGithubPing,
  checkClaudePing,
} from '../src/doctor/checks.js';
import type { DoctorCheckResult } from '../src/doctor/types.js';

const mockRunCli = vi.mocked(runCli);

function cliOk(stdout = '', stderr = '') {
  return { exitCode: 0, stdout, stderr };
}

function cliFail(stderr = '', stdout = '') {
  return { exitCode: 1, stdout, stderr };
}

function assertSchema(result: DoctorCheckResult) {
  expect(typeof result.id).toBe('string');
  expect(result.id.length).toBeGreaterThan(0);
  expect(typeof result.label).toBe('string');
  expect(result.label.length).toBeGreaterThan(0);
  expect(['error', 'warning', 'info']).toContain(result.severity);
  expect(['pass', 'fail', 'warn', 'skip']).toContain(result.status);
  expect(typeof result.detail).toBe('string');
  expect(Array.isArray(result.fixSteps)).toBe(true);
}

describe('DoctorCheckResult 스키마 검증', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsModule.accessSync).mockImplementation(() => undefined);
    vi.mocked(fsModule.existsSync).mockReturnValue(true);
    vi.mocked(fsModule.readFileSync).mockReturnValue('linux');
  });

  it('checkClaudeCli — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('claude 1.5.0'));
    const result = await checkClaudeCli();
    assertSchema(result);
    expect(result.id).toBe('claude-cli');
    expect(result.status).toBe('pass');
  });

  it('checkClaudeLogin — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('Logged in as user@example.com'));
    const result = await checkClaudeLogin();
    assertSchema(result);
    expect(result.id).toBe('claude-login');
    expect(result.status).toBe('pass');
  });

  it('checkGhCli — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('gh version 2.40.0 (2024-01-15)'));
    const result = await checkGhCli();
    assertSchema(result);
    expect(result.id).toBe('gh-cli');
    expect(result.status).toBe('pass');
  });

  it('checkGhAuth — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(
      cliOk("Logged in to github.com\nToken scopes: 'repo', 'workflow'"),
    );
    const result = await checkGhAuth();
    assertSchema(result);
    expect(result.id).toBe('gh-auth');
    expect(result.status).toBe('pass');
  });

  it('checkGitIdentity — 필수 필드 포함', async () => {
    mockRunCli
      .mockResolvedValueOnce(cliOk('Test User'))
      .mockResolvedValueOnce(cliOk('test@example.com'));
    const result = await checkGitIdentity();
    assertSchema(result);
    expect(result.id).toBe('git-identity');
    expect(result.status).toBe('pass');
  });

  it('checkNodeVersion — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('v20.11.0'));
    const result = await checkNodeVersion();
    assertSchema(result);
    expect(result.id).toBe('node-version');
    expect(result.status).toBe('pass');
  });

  it('checkSqliteNative — 필수 필드 포함', async () => {
    const result = await checkSqliteNative();
    assertSchema(result);
    expect(result.id).toBe('sqlite-native');
    expect(result.status).toBe('pass');
  });

  it('checkAqmWritable — 필수 필드 포함', async () => {
    const result = await checkAqmWritable();
    assertSchema(result);
    expect(result.id).toBe('aqm-writable');
    expect(result.status).toBe('pass');
  });

  it('checkGithubPing — 필수 필드 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('{"rate":{"limit":5000,"remaining":4999}}'));
    const result = await checkGithubPing();
    assertSchema(result);
    expect(result.id).toBe('github-ping');
    expect(result.status).toBe('pass');
  });

  it('checkClaudePing — 기본 skip 스키마 반환', async () => {
    const result = await checkClaudePing();
    assertSchema(result);
    expect(result.id).toBe('claude-ping');
    expect(result.status).toBe('skip');
  });
});

describe('fail 시나리오', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsModule.readFileSync).mockReturnValue('linux');
  });

  it('checkClaudeCli: exitCode 1 → status=fail, fixSteps>0, docsUrl 존재', async () => {
    mockRunCli.mockResolvedValue(cliFail('command not found: claude'));
    const result = await checkClaudeCli();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
    expect(result.docsUrl).toBeTruthy();
  });

  it('checkClaudeCli: 버전 < 최소(1.0.0) → status=warn, fixSteps>0', async () => {
    mockRunCli.mockResolvedValue(cliOk('0.9.0'));
    const result = await checkClaudeCli();
    expect(result.status).toBe('warn');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkClaudeLogin: not logged in → status=fail, fixSteps>0', async () => {
    mockRunCli.mockResolvedValue(cliFail('not logged in'));
    const result = await checkClaudeLogin();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
    expect(result.docsUrl).toBeTruthy();
  });

  it('checkGhAuth: 미로그인 → status=fail, fixSteps gh auth login 포함', async () => {
    mockRunCli.mockResolvedValue(cliFail('no credentials found'));
    const result = await checkGhAuth();
    expect(result.status).toBe('fail');
    expect(result.fixSteps).toContain('gh auth login');
  });

  it('checkGhAuth: scope 누락(repo, workflow 없음) → status=warn, detail에 누락 scope 포함', async () => {
    mockRunCli.mockResolvedValue(
      cliOk("Logged in to github.com\nToken scopes: 'read:org'"),
    );
    const result = await checkGhAuth();
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('repo');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkNodeVersion: v18 → status=fail, detail에 버전 포함', async () => {
    mockRunCli.mockResolvedValue(cliOk('v18.17.0'));
    const result = await checkNodeVersion();
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('18');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkNodeVersion: node 없음(exitCode 1) → status=fail', async () => {
    mockRunCli.mockResolvedValue(cliFail('not found'));
    const result = await checkNodeVersion();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkGitIdentity: user.name 누락 → status=fail, detail에 user.name 포함', async () => {
    mockRunCli
      .mockResolvedValueOnce(cliOk(''))
      .mockResolvedValueOnce(cliOk('test@example.com'));
    const result = await checkGitIdentity();
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('user.name');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkGithubPing: exitCode 1 → status=fail', async () => {
    mockRunCli.mockResolvedValue(cliFail('Could not resolve host'));
    const result = await checkGithubPing();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkClaudePing: enableClaudePing=true, exitCode 1 → status=fail', async () => {
    mockRunCli.mockResolvedValue(cliFail('API key invalid'));
    const result = await checkClaudePing({ enableClaudePing: true });
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkClaudePing: enableClaudePing=true, 성공 → status=pass', async () => {
    mockRunCli.mockResolvedValue(cliOk('Hello!'));
    const result = await checkClaudePing({ enableClaudePing: true });
    expect(result.status).toBe('pass');
  });

  it('checkAqmWritable: 디렉토리 미존재 + 부모 쓰기 가능 → status=warn', async () => {
    vi.mocked(fsModule.existsSync).mockReturnValue(false);
    vi.mocked(fsModule.accessSync).mockImplementation(() => undefined);
    const result = await checkAqmWritable();
    expect(result.status).toBe('warn');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });

  it('checkAqmWritable: accessSync 예외 → status=fail', async () => {
    vi.mocked(fsModule.existsSync).mockReturnValue(true);
    vi.mocked(fsModule.accessSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const result = await checkAqmWritable();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
  });
});

describe('checkSqliteNative fail 시나리오', () => {
  it('better-sqlite3 로드 실패 → status=fail, fixSteps>0, detail에 native 포함', async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => {
      throw new Error('node_modules not found');
    });
    const { checkSqliteNative: check } = await import('../src/doctor/checks.js');
    const result = await check();
    expect(result.status).toBe('fail');
    expect(result.fixSteps.length).toBeGreaterThan(0);
    expect(result.detail.toLowerCase()).toContain('native');
  });
});
