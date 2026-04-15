import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INSTALL_SH = resolve(__dirname, '..', 'install.sh');

/**
 * install.sh에서 detect_os 함수를 추출하고,
 * 하드코딩된 /proc/sys/kernel/osrelease 경로를 테스트용 경로로 교체한다.
 */
function extractDetectOsFn(osreleasePath: string): string {
  const content = readFileSync(INSTALL_SH, 'utf-8');
  const lines = content.split('\n');
  const funcLines: string[] = [];
  let collecting = false;
  let braceDepth = 0;

  for (const line of lines) {
    if (!collecting && /^detect_os\(\)/.test(line)) {
      collecting = true;
    }
    if (collecting) {
      funcLines.push(line);
      braceDepth += (line.match(/\{/g) ?? []).length;
      braceDepth -= (line.match(/\}/g) ?? []).length;
      if (braceDepth === 0 && funcLines.length > 1) break;
    }
  }

  if (funcLines.length === 0) throw new Error('detect_os() function not found in install.sh');
  return funcLines.join('\n').replace(/\/proc\/sys\/kernel\/osrelease/g, osreleasePath);
}

interface RunDetectOsOpts {
  uname?: string;
  wslDistroName?: string;
  wslInterop?: string;
  osreleaseContent?: string;
}

function runDetectOs(opts: RunDetectOsOpts = {}): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'aqm-detect-os-'));
  try {
    // mock uname 바이너리 — PATH 앞에 삽입해 시스템 uname을 대체
    const mockUname = join(tmpDir, 'uname');
    writeFileSync(mockUname, `#!/bin/bash\necho "${opts.uname ?? 'Linux'}"\n`);
    chmodSync(mockUname, 0o755);

    // osrelease 임시 파일 (내용이 주어진 경우에만 생성)
    const osreleasePath = join(tmpDir, 'osrelease');
    if (opts.osreleaseContent !== undefined) {
      writeFileSync(osreleasePath, opts.osreleaseContent);
    }

    const detectOsFn = extractDetectOsFn(osreleasePath);
    const script = `${detectOsFn}\ndetect_os`;

    const env: NodeJS.ProcessEnv = {
      HOME: process.env['HOME'] ?? '/tmp',
      PATH: `${tmpDir}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    };
    if (opts.wslDistroName !== undefined) env['WSL_DISTRO_NAME'] = opts.wslDistroName;
    if (opts.wslInterop !== undefined) env['WSL_INTEROP'] = opts.wslInterop;

    return execSync('bash', { input: script, env }).toString().trim();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * install.sh의 Node.js 버전 체크 로직을 독립 실행해 통과 여부를 반환한다.
 * true = v20 이상 (설치 계속), false = v20 미만 (exit 1)
 */
function checkNodeVersionAccepted(version: string): boolean {
  const script = `
NODE_VERSION="${version}"
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\\([0-9]*\\).*/\\1/')
if [ "\${NODE_MAJOR:-0}" -lt 20 ] 2>/dev/null; then
  exit 1
fi
exit 0
`;
  try {
    execSync('bash', { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

describe('install.sh', () => {
  describe('detect_os()', () => {
    it('macOS: uname=Darwin → "macos"', () => {
      expect(runDetectOs({ uname: 'Darwin' })).toBe('macos');
    });

    it('Linux: uname=Linux, WSL 마커 없음 → "linux"', () => {
      expect(runDetectOs({ uname: 'Linux' })).toBe('linux');
    });

    it('WSL: WSL_DISTRO_NAME 설정 시 → "wsl"', () => {
      expect(runDetectOs({ uname: 'Linux', wslDistroName: 'Ubuntu' })).toBe('wsl');
    });

    it('WSL: WSL_INTEROP 설정 시 → "wsl"', () => {
      expect(runDetectOs({ uname: 'Linux', wslInterop: '/run/WSL/1_interop' })).toBe('wsl');
    });

    it('WSL: osrelease에 "microsoft" 포함 → "wsl"', () => {
      expect(runDetectOs({
        uname: 'Linux',
        osreleaseContent: '5.15.167.4-microsoft-standard-WSL2\n',
      })).toBe('wsl');
    });

    it('WSL: osrelease에 "WSL" 포함 (대소문자 무관) → "wsl"', () => {
      expect(runDetectOs({
        uname: 'Linux',
        osreleaseContent: '5.10.0-WSL2-custom\n',
      })).toBe('wsl');
    });

    it('WSL env var가 non-WSL osrelease보다 우선 → "wsl"', () => {
      expect(runDetectOs({
        uname: 'Linux',
        wslDistroName: 'Ubuntu',
        osreleaseContent: '6.1.0-generic\n',
      })).toBe('wsl');
    });

    it('Linux: osrelease에 WSL 마커 없음 → "linux"', () => {
      expect(runDetectOs({
        uname: 'Linux',
        osreleaseContent: '6.1.0-generic\n',
      })).toBe('linux');
    });

    it('Windows: uname=MINGW64_NT-10.0 → "windows"', () => {
      expect(runDetectOs({ uname: 'MINGW64_NT-10.0' })).toBe('windows');
    });

    it('Windows: uname=CYGWIN_NT-10.0 → "windows"', () => {
      expect(runDetectOs({ uname: 'CYGWIN_NT-10.0' })).toBe('windows');
    });

    it('Windows: uname=MSYS_NT-10.0 → "windows"', () => {
      expect(runDetectOs({ uname: 'MSYS_NT-10.0' })).toBe('windows');
    });

    it('알 수 없는 OS: uname=FreeBSD → "unknown"', () => {
      expect(runDetectOs({ uname: 'FreeBSD' })).toBe('unknown');
    });
  });

  describe('Node.js 버전 체크', () => {
    it('v20.0.0 → 통과', () => {
      expect(checkNodeVersionAccepted('v20.0.0')).toBe(true);
    });

    it('v22.5.1 → 통과', () => {
      expect(checkNodeVersionAccepted('v22.5.1')).toBe(true);
    });

    it('v20.17.0 → 통과 (정확히 v20)', () => {
      expect(checkNodeVersionAccepted('v20.17.0')).toBe(true);
    });

    it('v18.20.0 → 거부 (v20 미만)', () => {
      expect(checkNodeVersionAccepted('v18.20.0')).toBe(false);
    });

    it('v16.0.0 → 거부 (v20 미만)', () => {
      expect(checkNodeVersionAccepted('v16.0.0')).toBe(false);
    });

    it('v19.9.9 → 거부 (v20 미만)', () => {
      expect(checkNodeVersionAccepted('v19.9.9')).toBe(false);
    });
  });
});
