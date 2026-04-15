import { execFile } from 'child_process';
import { access, constants } from 'fs/promises';
import { homedir } from 'os';

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

export type CheckStatus = 'pass' | 'fail' | 'warn';
export type CheckSeverity = 'critical' | 'warning' | 'info';

export interface DoctorCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  status: CheckStatus;
  detail: string;
  fixSteps: string[];
  autoFixCommand?: string;
  docsUrl?: string;
  healLevel?: 1 | 2 | 3;
}

export interface RunAllChecksOptions {
  enableClaudePing?: boolean;
}

async function checkClaudeCli(): Promise<DoctorCheck> {
  try {
    await execFileAsync('which', ['claude']);
    return {
      id: 'claude-cli',
      label: 'Claude CLI',
      severity: 'critical',
      status: 'pass',
      detail: 'claude CLI가 PATH에 존재합니다.',
      fixSteps: [],
    };
  } catch {
    return {
      id: 'claude-cli',
      label: 'Claude CLI',
      severity: 'critical',
      status: 'fail',
      detail: 'claude CLI를 찾을 수 없습니다.',
      fixSteps: [
        'npm install -g @anthropic-ai/claude-code 또는 공식 설치 가이드를 참조하세요.',
        'PATH 환경변수에 claude 바이너리 경로가 포함되어 있는지 확인하세요.',
      ],
      autoFixCommand: 'npm install -g @anthropic-ai/claude-code',
      docsUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
      healLevel: 2,
    };
  }
}

async function checkClaudeLogin(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('claude', ['auth', 'status']);
    const isLoggedIn = stdout.includes('Logged in') || stdout.includes('logged in') || stdout.includes('"loggedIn": true') || stdout.includes('"loggedIn":true');
    if (isLoggedIn) {
      return {
        id: 'claude-login',
        label: 'Claude 로그인 상태',
        severity: 'critical',
        status: 'pass',
        detail: 'Claude에 로그인되어 있습니다.',
        fixSteps: [],
      };
    }
    return {
      id: 'claude-login',
      label: 'Claude 로그인 상태',
      severity: 'critical',
      status: 'fail',
      detail: 'Claude에 로그인되어 있지 않습니다.',
      fixSteps: ['claude auth login 명령어로 로그인하세요.'],
      autoFixCommand: 'claude auth login',
      healLevel: 2,
    };
  } catch {
    return {
      id: 'claude-login',
      label: 'Claude 로그인 상태',
      severity: 'critical',
      status: 'fail',
      detail: 'Claude 로그인 상태를 확인할 수 없습니다.',
      fixSteps: [
        'claude CLI가 설치되어 있는지 확인하세요.',
        'claude auth login 명령어로 로그인하세요.',
      ],
      autoFixCommand: 'claude auth login',
      healLevel: 2,
    };
  }
}

async function checkGhCli(): Promise<DoctorCheck> {
  try {
    await execFileAsync('which', ['gh']);
    return {
      id: 'gh-cli',
      label: 'GitHub CLI (gh)',
      severity: 'critical',
      status: 'pass',
      detail: 'gh CLI가 PATH에 존재합니다.',
      fixSteps: [],
    };
  } catch {
    return {
      id: 'gh-cli',
      label: 'GitHub CLI (gh)',
      severity: 'critical',
      status: 'fail',
      detail: 'gh CLI를 찾을 수 없습니다.',
      fixSteps: [
        'https://cli.github.com/ 에서 GitHub CLI를 설치하세요.',
        'PATH 환경변수에 gh 바이너리 경로가 포함되어 있는지 확인하세요.',
      ],
      autoFixCommand: 'brew install gh',
      docsUrl: 'https://cli.github.com/',
      healLevel: 3,
    };
  }
}

async function checkGhAuth(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'status']);
    const hasRepo = stdout.includes('repo');
    const hasWorkflow = stdout.includes('workflow');
    if (hasRepo && hasWorkflow) {
      return {
        id: 'gh-auth',
        label: 'GitHub CLI 인증 및 scope',
        severity: 'critical',
        status: 'pass',
        detail: 'gh CLI가 인증되어 있으며 repo·workflow scope를 보유합니다.',
        fixSteps: [],
      };
    }
    const missing: string[] = [];
    if (!hasRepo) missing.push('repo');
    if (!hasWorkflow) missing.push('workflow');
    return {
      id: 'gh-auth',
      label: 'GitHub CLI 인증 및 scope',
      severity: 'critical',
      status: 'fail',
      detail: `필요한 scope가 없습니다: ${missing.join(', ')}`,
      fixSteps: [
        `gh auth refresh -s ${missing.join(',')} 명령어로 scope를 추가하세요.`,
      ],
      autoFixCommand: `gh auth refresh -s ${missing.join(',')}`,
      healLevel: 2,
    };
  } catch {
    return {
      id: 'gh-auth',
      label: 'GitHub CLI 인증 및 scope',
      severity: 'critical',
      status: 'fail',
      detail: 'gh CLI가 인증되어 있지 않습니다.',
      fixSteps: [
        'gh auth login 명령어로 GitHub에 로그인하세요.',
        'gh auth refresh -s repo,workflow 명령어로 필요한 scope를 추가하세요.',
      ],
      autoFixCommand: 'gh auth login',
      healLevel: 2,
    };
  }
}

async function checkNodeVersion(): Promise<DoctorCheck> {
  const versionString = process.versions.node;
  const major = parseInt(versionString.split('.')[0] ?? '0', 10);

  if (major >= 20) {
    return {
      id: 'node-version',
      label: 'Node.js 버전 (≥ 20)',
      severity: 'critical',
      status: 'pass',
      detail: `Node.js v${versionString} — 요구사항을 충족합니다.`,
      fixSteps: [],
    };
  }

  return {
    id: 'node-version',
    label: 'Node.js 버전 (≥ 20)',
    severity: 'critical',
    status: 'fail',
    detail: `Node.js v${versionString} — v20 이상이 필요합니다.`,
    fixSteps: [
      'https://nodejs.org/ 에서 Node.js v20 이상을 설치하세요.',
      'nvm을 사용하는 경우: nvm install 20 && nvm use 20',
    ],
    autoFixCommand: 'nvm install 20 && nvm use 20',
    docsUrl: 'https://nodejs.org/',
    healLevel: 3,
  };
}

async function checkGitIdentity(): Promise<DoctorCheck> {
  try {
    const [nameResult, emailResult] = await Promise.allSettled([
      execFileAsync('git', ['config', 'user.name']),
      execFileAsync('git', ['config', 'user.email']),
    ]);

    const name = nameResult.status === 'fulfilled' ? nameResult.value.stdout.trim() : '';
    const email = emailResult.status === 'fulfilled' ? emailResult.value.stdout.trim() : '';

    if (name && email) {
      return {
        id: 'git-identity',
        label: 'Git 사용자 정보',
        severity: 'warning',
        status: 'pass',
        detail: `git user: ${name} <${email}>`,
        fixSteps: [],
      };
    }

    const missing: string[] = [];
    if (!name) missing.push('user.name');
    if (!email) missing.push('user.email');

    return {
      id: 'git-identity',
      label: 'Git 사용자 정보',
      severity: 'warning',
      status: 'fail',
      detail: `git config 미설정: ${missing.join(', ')}`,
      fixSteps: [
        ...(!name ? ['git config --global user.name "Your Name"'] : []),
        ...(!email ? ['git config --global user.email "you@example.com"'] : []),
      ],
      healLevel: 1,
    };
  } catch {
    return {
      id: 'git-identity',
      label: 'Git 사용자 정보',
      severity: 'warning',
      status: 'fail',
      detail: 'git config 확인 중 오류가 발생했습니다.',
      fixSteps: [
        'git config --global user.name "Your Name"',
        'git config --global user.email "you@example.com"',
      ],
      healLevel: 3,
    };
  }
}

async function checkSqlite3(): Promise<DoctorCheck> {
  try {
    await import('better-sqlite3');
    return {
      id: 'sqlite3',
      label: 'better-sqlite3 native addon',
      severity: 'critical',
      status: 'pass',
      detail: 'better-sqlite3 native addon이 정상 로드됩니다.',
      fixSteps: [],
    };
  } catch (err) {
    return {
      id: 'sqlite3',
      label: 'better-sqlite3 native addon',
      severity: 'critical',
      status: 'fail',
      detail: `better-sqlite3 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
      fixSteps: [
        'npm rebuild better-sqlite3 명령어로 native addon을 재빌드하세요.',
        'node-gyp 빌드 도구가 설치되어 있는지 확인하세요.',
      ],
      autoFixCommand: 'npm rebuild better-sqlite3',
      healLevel: 1,
    };
  }
}

async function checkAqmDirWrite(): Promise<DoctorCheck> {
  const aqmDir = `${homedir()}/.aqm`;
  try {
    await access(aqmDir, constants.W_OK);
    return {
      id: 'aqm-dir-write',
      label: 'AQM 디렉토리 쓰기 권한',
      severity: 'critical',
      status: 'pass',
      detail: `${aqmDir} 에 쓰기 권한이 있습니다.`,
      fixSteps: [],
    };
  } catch {
    return {
      id: 'aqm-dir-write',
      label: 'AQM 디렉토리 쓰기 권한',
      severity: 'critical',
      status: 'fail',
      detail: `${aqmDir} 에 쓰기 권한이 없거나 디렉토리가 존재하지 않습니다.`,
      fixSteps: [
        `mkdir -p ${aqmDir} 명령어로 디렉토리를 생성하세요.`,
        `chmod 755 ${aqmDir} 명령어로 권한을 설정하세요.`,
      ],
      healLevel: 1,
    };
  }
}

async function checkGitHubApiPing(): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync('gh', ['api', '/user', '--jq', '.login']);
    const login = stdout.trim();
    return {
      id: 'github-api-ping',
      label: 'GitHub API 접근',
      severity: 'warning',
      status: 'pass',
      detail: `GitHub API 접근 가능 (로그인: ${login})`,
      fixSteps: [],
    };
  } catch {
    return {
      id: 'github-api-ping',
      label: 'GitHub API 접근',
      severity: 'warning',
      status: 'fail',
      detail: 'GitHub API에 접근할 수 없습니다.',
      fixSteps: [
        'gh auth login 명령어로 GitHub에 로그인하세요.',
        '네트워크 연결 상태를 확인하세요.',
      ],
      autoFixCommand: 'gh auth login',
      healLevel: 2,
    };
  }
}

async function checkClaudePing(): Promise<DoctorCheck> {
  try {
    await execFileAsync('claude', ['--version']);
    return {
      id: 'claude-ping',
      label: 'Claude CLI 응답',
      severity: 'info',
      status: 'pass',
      detail: 'Claude CLI가 응답합니다.',
      fixSteps: [],
    };
  } catch {
    return {
      id: 'claude-ping',
      label: 'Claude CLI 응답',
      severity: 'info',
      status: 'fail',
      detail: 'Claude CLI가 응답하지 않습니다.',
      fixSteps: [
        'claude CLI가 정상 설치되어 있는지 확인하세요.',
        'npm install -g @anthropic-ai/claude-code 로 재설치하세요.',
      ],
      autoFixCommand: 'npm install -g @anthropic-ai/claude-code',
      healLevel: 2,
    };
  }
}

export async function runAllChecks(options: RunAllChecksOptions = {}): Promise<DoctorCheck[]> {
  const { enableClaudePing = false } = options;

  const checks: Promise<DoctorCheck>[] = [
    checkClaudeCli(),
    checkClaudeLogin(),
    checkGhCli(),
    checkGhAuth(),
    checkNodeVersion(),
    checkGitIdentity(),
    checkSqlite3(),
    checkAqmDirWrite(),
    checkGitHubApiPing(),
  ];

  if (enableClaudePing) {
    checks.push(checkClaudePing());
  }

  const results = await Promise.allSettled(checks);

  return results.map((result): DoctorCheck => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      id: 'unknown',
      label: 'Unknown Check',
      severity: 'critical',
      status: 'fail',
      detail: result.reason instanceof Error ? result.reason.message : String(result.reason),
      fixSteps: [],
    };
  });
}
