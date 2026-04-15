import { accessSync, constants, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { runCli } from '../utils/cli-runner.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { DoctorCheck, DoctorCheckOptions, DoctorCheckResult } from './types.js';

const MIN_CLAUDE_VERSION = '1.0.0';

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Check 1: claude CLI 설치 여부 + 버전 확인 */
export const checkClaudeCli: DoctorCheck = async (_opts?: DoctorCheckOptions): Promise<DoctorCheckResult> => {
  const result = await runCli('claude', ['--version'], { timeout: 5000 });
  const output = (result.stdout + result.stderr).trim();

  if (result.exitCode !== 0 || output === '') {
    return {
      id: 'claude-cli',
      label: 'Claude CLI 설치',
      severity: 'error',
      status: 'fail',
      detail: "claude CLI를 찾을 수 없습니다. PATH에 설치되어 있는지 확인하세요.",
      fixSteps: ['npm install -g @anthropic-ai/claude-code'],
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    };
  }

  const match = output.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    return {
      id: 'claude-cli',
      label: 'Claude CLI 설치',
      severity: 'error',
      status: 'pass',
      detail: `claude CLI 설치됨 (버전 파싱 불가: ${output.slice(0, 40)})`,
      fixSteps: [],
    };
  }

  const version = match[1];
  if (compareSemver(version, MIN_CLAUDE_VERSION) < 0) {
    return {
      id: 'claude-cli',
      label: 'Claude CLI 설치',
      severity: 'warning',
      status: 'warn',
      detail: `claude CLI v${version} 설치됨 — 최소 권장 버전은 v${MIN_CLAUDE_VERSION}입니다`,
      fixSteps: ['npm install -g @anthropic-ai/claude-code', 'claude update'],
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    };
  }

  return {
    id: 'claude-cli',
    label: 'Claude CLI 설치',
    severity: 'error',
    status: 'pass',
    detail: `claude CLI v${version}`,
    fixSteps: [],
  };
};

/** Check 2: claude 로그인 상태 확인 */
export const checkClaudeLogin: DoctorCheck = async (_opts?: DoctorCheckOptions): Promise<DoctorCheckResult> => {
  const result = await runCli('claude', ['auth', 'status'], { timeout: 10000 });
  const output = (result.stdout + result.stderr).trim();

  const notLoggedIn =
    result.exitCode !== 0 ||
    output.toLowerCase().includes('not logged in') ||
    output.toLowerCase().includes('not authenticated') ||
    output === '';

  if (notLoggedIn) {
    return {
      id: 'claude-login',
      label: 'Claude 로그인',
      severity: 'error',
      status: 'fail',
      detail: 'claude에 로그인되어 있지 않습니다',
      fixSteps: ['claude login'],
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    };
  }

  return {
    id: 'claude-login',
    label: 'Claude 로그인',
    severity: 'error',
    status: 'pass',
    detail: 'claude 인증 확인됨',
    fixSteps: [],
  };
};

/** Check 3: gh CLI 설치 여부 확인 */
export const checkGhCli: DoctorCheck = async (_opts?: DoctorCheckOptions): Promise<DoctorCheckResult> => {
  const result = await runCli('gh', ['--version'], { timeout: 5000 });
  const output = (result.stdout + result.stderr).trim();

  if (result.exitCode !== 0 || output === '') {
    return {
      id: 'gh-cli',
      label: 'GitHub CLI (gh) 설치',
      severity: 'error',
      status: 'fail',
      detail: "gh CLI를 찾을 수 없습니다. PATH에 설치되어 있는지 확인하세요.",
      fixSteps: [
        'brew install gh  # macOS',
        '# 또는 https://cli.github.com/ 에서 설치',
      ],
      docsUrl: 'https://cli.github.com/',
    };
  }

  const match = output.match(/gh version (\S+)/);
  const version = match ? match[1] : output.split('\n')[0].trim();

  return {
    id: 'gh-cli',
    label: 'GitHub CLI (gh) 설치',
    severity: 'error',
    status: 'pass',
    detail: `gh CLI 설치됨 (${version})`,
    fixSteps: [],
  };
};

/** Check 4: gh 인증 + scope (repo, workflow) 확인 */
export const checkGhAuth: DoctorCheck = async (_opts?: DoctorCheckOptions): Promise<DoctorCheckResult> => {
  const result = await runCli('gh', ['auth', 'status'], { timeout: 10000 });
  const output = result.stdout + result.stderr;

  const notLoggedIn =
    result.exitCode !== 0 &&
    (output.toLowerCase().includes('not logged in') ||
      output.toLowerCase().includes('no credentials found') ||
      output.trim() === '');

  if (notLoggedIn) {
    return {
      id: 'gh-auth',
      label: 'GitHub CLI 인증',
      severity: 'error',
      status: 'fail',
      detail: 'gh에 로그인되어 있지 않습니다',
      fixSteps: ['gh auth login'],
      docsUrl: 'https://cli.github.com/manual/gh_auth_login',
    };
  }

  // scope 파싱: "Token scopes: 'repo', 'workflow'" 형태
  const scopeMatch = output.match(/[Tt]oken scopes?:\s*(.+)/);
  const scopeLine = scopeMatch ? scopeMatch[1] : '';
  const scopes = scopeLine.match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];

  const missingScopes: string[] = [];
  if (!scopes.includes('repo')) missingScopes.push('repo');
  if (!scopes.includes('workflow')) missingScopes.push('workflow');

  if (missingScopes.length > 0) {
    return {
      id: 'gh-auth',
      label: 'GitHub CLI 인증',
      severity: 'warning',
      status: 'warn',
      detail: `gh 인증됨, 누락된 scope: ${missingScopes.join(', ')}`,
      fixSteps: [`gh auth refresh -s ${missingScopes.join(',')}`],
      docsUrl: 'https://cli.github.com/manual/gh_auth_refresh',
    };
  }

  return {
    id: 'gh-auth',
    label: 'GitHub CLI 인증',
    severity: 'error',
    status: 'pass',
    detail: `gh 인증됨, scope: ${scopes.join(', ') || '확인됨'}`,
    fixSteps: [],
  };
};

/** Check 5: git user.name + user.email 설정 확인 */
export const checkGitIdentity: DoctorCheck = async (_opts?: DoctorCheckOptions): Promise<DoctorCheckResult> => {
  const [nameResult, emailResult] = await Promise.all([
    runCli('git', ['config', 'user.name'], { timeout: 5000 }),
    runCli('git', ['config', 'user.email'], { timeout: 5000 }),
  ]);

  const name = nameResult.stdout.trim();
  const email = emailResult.stdout.trim();

  const missing: string[] = [];
  if (!name) missing.push('user.name');
  if (!email) missing.push('user.email');

  if (missing.length > 0) {
    const fixSteps = missing.map(field =>
      field === 'user.name'
        ? 'git config --global user.name "Your Name"'
        : 'git config --global user.email "you@example.com"',
    );
    return {
      id: 'git-identity',
      label: 'Git 사용자 정보',
      severity: 'error',
      status: 'fail',
      detail: `git 사용자 정보 누락: ${missing.join(', ')}`,
      fixSteps,
    };
  }

  return {
    id: 'git-identity',
    label: 'Git 사용자 정보',
    severity: 'error',
    status: 'pass',
    detail: `git identity 설정됨 (${name} <${email}>)`,
    fixSteps: [],
  };
};

// ── helpers (checks 6-10) ─────────────────────────────────────────────────────

function isWsl(): boolean {
  if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) return true;
  try {
    const release = readFileSync('/proc/sys/kernel/osrelease', 'utf-8').toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

function parseSemverMajor(version: string): number | null {
  const m = version.trim().replace(/^v/, '').match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

/** Check 6: Node.js 버전 >= 20 확인 */
export const checkNodeVersion: DoctorCheck = async (
  _opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult> => {
  const id = 'node-version';
  const label = 'Node.js >= 20';

  try {
    const result = await runCli('node', ['--version'], { timeout: 5000 });
    if (result.exitCode !== 0) {
      return {
        id,
        label,
        severity: 'error',
        status: 'fail',
        detail: `node 실행 실패: ${result.stderr.trim() || 'not found'}`,
        fixSteps: ['nvm install 20', 'nvm use 20'],
      };
    }

    const versionStr = result.stdout.trim();
    const major = parseSemverMajor(versionStr);

    if (major === null) {
      return {
        id,
        label,
        severity: 'error',
        status: 'fail',
        detail: `버전 파싱 실패: ${versionStr}`,
        fixSteps: ['nvm install 20', 'nvm use 20'],
      };
    }

    const wslSuffix = isWsl() ? ' (WSL 환경)' : '';

    if (major < 20) {
      return {
        id,
        label,
        severity: 'error',
        status: 'fail',
        detail: `현재 버전: ${versionStr} — Node.js 20 이상 필요${wslSuffix}`,
        fixSteps: ['nvm install 20', 'nvm use 20'],
      };
    }

    return {
      id,
      label,
      severity: 'error',
      status: 'pass',
      detail: `${versionStr}${wslSuffix}`,
      fixSteps: [],
    };
  } catch (err: unknown) {
    return {
      id,
      label,
      severity: 'error',
      status: 'fail',
      detail: getErrorMessage(err),
      fixSteps: ['nvm install 20', 'nvm use 20'],
    };
  }
};

/** Check 7: better-sqlite3 native 바이너리 로드 가능 여부 */
export const checkSqliteNative: DoctorCheck = async (
  _opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult> => {
  const id = 'sqlite-native';
  const label = 'better-sqlite3 native 바이너리';

  try {
    await import('better-sqlite3');
    return {
      id,
      label,
      severity: 'error',
      status: 'pass',
      detail: 'better-sqlite3 로드 성공',
      fixSteps: [],
    };
  } catch (err: unknown) {
    return {
      id,
      label,
      severity: 'error',
      status: 'fail',
      detail: `native 바이너리 로드 실패: ${getErrorMessage(err)}`,
      fixSteps: ['npm rebuild better-sqlite3', 'npm install'],
    };
  }
};

/** Check 8: ~/.aqm (또는 AQM_HOME) 디렉토리 쓰기 권한 */
export const checkAqmWritable: DoctorCheck = async (
  _opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult> => {
  const id = 'aqm-writable';
  const label = '~/.aqm 쓰기 권한';

  const aqmHome = process.env['AQM_HOME'] ?? join(homedir(), '.aqm');

  try {
    if (existsSync(aqmHome)) {
      accessSync(aqmHome, constants.W_OK);
      return {
        id,
        label,
        severity: 'error',
        status: 'pass',
        detail: `${aqmHome} 쓰기 가능`,
        fixSteps: [],
      };
    }

    // 디렉토리 미존재 시 부모 디렉토리 쓰기 가능 여부 확인
    const parent = dirname(aqmHome);
    accessSync(parent, constants.W_OK);
    return {
      id,
      label,
      severity: 'warning',
      status: 'warn',
      detail: `${aqmHome} 미존재 — 부모 디렉토리(${parent}) 쓰기 가능`,
      fixSteps: ['mkdir -p ~/.aqm && chmod 755 ~/.aqm'],
    };
  } catch (err: unknown) {
    return {
      id,
      label,
      severity: 'error',
      status: 'fail',
      detail: `${aqmHome} 쓰기 불가: ${getErrorMessage(err)}`,
      fixSteps: ['mkdir -p ~/.aqm && chmod 755 ~/.aqm'],
    };
  }
};

/** Check 9: gh api /rate_limit으로 GitHub API 연결 확인 */
export const checkGithubPing: DoctorCheck = async (
  _opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult> => {
  const id = 'github-ping';
  const label = 'GitHub API 연결';

  try {
    const result = await runCli('gh', ['api', '/rate_limit'], { timeout: 10000 });
    if (result.exitCode !== 0) {
      return {
        id,
        label,
        severity: 'error',
        status: 'fail',
        detail: `gh api /rate_limit 실패: ${result.stderr.trim() || result.stdout.trim()}`,
        fixSteps: ['네트워크 연결 확인', 'gh auth login'],
      };
    }
    return {
      id,
      label,
      severity: 'error',
      status: 'pass',
      detail: 'GitHub API 응답 정상',
      fixSteps: [],
    };
  } catch (err: unknown) {
    return {
      id,
      label,
      severity: 'error',
      status: 'fail',
      detail: getErrorMessage(err),
      fixSteps: ['네트워크 연결 확인', 'gh auth login'],
    };
  }
};

/** Check 10: Claude CLI 1토큰 ping (기본 skip — enableClaudePing=true 시 활성화) */
export const checkClaudePing: DoctorCheck = async (
  opts?: DoctorCheckOptions,
): Promise<DoctorCheckResult> => {
  const id = 'claude-ping';
  const label = 'Claude CLI ping';

  if (!opts?.enableClaudePing) {
    return {
      id,
      label,
      severity: 'info',
      status: 'skip',
      detail: '비용 회피를 위해 기본 skip (enableClaudePing=true로 활성화)',
      fixSteps: [],
    };
  }

  try {
    const result = await runCli(
      'claude',
      ['--model', 'claude-haiku-4-5', '--max-turns', '1', '-p', 'hi'],
      { timeout: 30000 },
    );

    if (result.exitCode !== 0) {
      return {
        id,
        label,
        severity: 'error',
        status: 'fail',
        detail: `Claude CLI 응답 실패: ${result.stderr.trim() || result.stdout.trim()}`,
        fixSteps: ['claude login', 'API 키 확인'],
      };
    }

    return {
      id,
      label,
      severity: 'error',
      status: 'pass',
      detail: 'Claude CLI 응답 정상',
      fixSteps: [],
    };
  } catch (err: unknown) {
    return {
      id,
      label,
      severity: 'error',
      status: 'fail',
      detail: getErrorMessage(err),
      fixSteps: ['claude login', 'API 키 확인'],
    };
  }
};
