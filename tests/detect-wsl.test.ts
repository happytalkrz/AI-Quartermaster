import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectWSL } from '../src/utils/detect-wsl.js';

/**
 * detectWSL 엣지 케이스 테스트
 * 기본 시나리오는 tests/utils/detect-wsl.test.ts에서 커버한다.
 * 여기서는 빈 문자열, 대소문자, 복수 env var 동시 설정 등 경계 조건을 검증한다.
 *
 * 주의: WSL 환경에서 실행되므로 osreleasePath를 반드시 임시 파일로 지정해야
 * /proc/sys/kernel/osrelease 의 실제 내용에 영향을 받지 않는다.
 */
describe('detectWSL (edge cases)', () => {
  it('WSL_DISTRO_NAME=""(빈 문자열) → false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '6.1.0-generic\n');
    expect(detectWSL({ env: { WSL_DISTRO_NAME: '' }, osreleasePath })).toBe(false);
  });

  it('WSL_INTEROP=""(빈 문자열) → false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '6.1.0-generic\n');
    expect(detectWSL({ env: { WSL_INTEROP: '' }, osreleasePath })).toBe(false);
  });

  it('두 env var 동시 설정 → true', () => {
    expect(detectWSL({
      env: { WSL_DISTRO_NAME: 'Ubuntu', WSL_INTEROP: '/run/WSL/1_interop' },
    })).toBe(true);
  });

  it('osrelease에 "Microsoft" (대문자 M) → true (소문자 변환 후 비교)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '5.15.167.4-Microsoft-standard-WSL2\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(true);
  });

  it('osrelease에 "WSL" (대문자) → true (소문자 변환 후 비교)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '5.10.0-WSL2-custom\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(true);
  });

  it('osrelease가 여러 줄이어도 "microsoft" 포함 시 → true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, 'info: some\n5.15.167.4-microsoft-standard-WSL2\nextra: line\n');
    expect(detectWSL({ env: {}, osreleasePath })).toBe(true);
  });

  it('WSL_DISTRO_NAME만 undefined → env var 조건 불충족', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsl-edge-'));
    const osreleasePath = join(dir, 'osrelease');
    writeFileSync(osreleasePath, '6.1.0-generic\n');
    expect(detectWSL({ env: { WSL_DISTRO_NAME: undefined }, osreleasePath })).toBe(false);
  });

  it('options 미전달 시 예외 없이 실행됨 (process.env 사용)', () => {
    expect(() => detectWSL()).not.toThrow();
  });
});
