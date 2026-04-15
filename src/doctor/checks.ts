import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type CheckStatus = 'pass' | 'fail' | 'warn';
export type CheckSeverity = 'critical' | 'warning' | 'info';

export interface DoctorCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  status: CheckStatus;
  detail: string;
  fixSteps: string[];
  docsUrl?: string;
  healLevel?: 1 | 2 | 3;
  autoFixCommand?: string;
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
      docsUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
      healLevel: 2,
      autoFixCommand: 'npm install -g @anthropic-ai/claude-code',
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
      docsUrl: 'https://cli.github.com/',
      healLevel: 3,
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
    docsUrl: 'https://nodejs.org/',
    healLevel: 3,
  };
}

export async function runAllChecks(): Promise<DoctorCheck[]> {
  const results = await Promise.allSettled([
    checkClaudeCli(),
    checkGhCli(),
    checkNodeVersion(),
  ]);

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
