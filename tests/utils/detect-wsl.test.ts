import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectWSL } from '../../src/utils/detect-wsl.js';

describe('detectWSL', () => {
  it('returns true when WSL_DISTRO_NAME is set', () => {
    expect(detectWSL({ env: { WSL_DISTRO_NAME: 'Ubuntu' } })).toBe(true);
  });

  it('returns true when WSL_INTEROP is set', () => {
    expect(detectWSL({ env: { WSL_INTEROP: '/run/WSL/1_interop' } })).toBe(true);
  });

  it('returns true when osrelease contains "microsoft"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-test-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '5.15.167.4-microsoft-standard-WSL2\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(true);
  });

  it('returns true when osrelease contains "WSL" (case-insensitive)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-test-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '5.10.0-WSL2-custom\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(true);
  });

  it('env vars take priority — returns true without reading osrelease', () => {
    // 존재하지 않는 경로를 주입해도 env var가 있으면 true
    expect(detectWSL({
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      osreleasePath: '/nonexistent/path/osrelease',
    })).toBe(true);
  });

  it('returns false when env vars absent and osrelease has no WSL marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-test-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '6.1.0-generic\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(false);
  });

  it('returns false when osrelease file does not exist', () => {
    expect(detectWSL({
      env: {},
      osreleasePath: '/nonexistent/path/osrelease',
    })).toBe(false);
  });

  it('returns false when all conditions are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-test-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, 'Linux 6.0.0\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(false);
  });
});
