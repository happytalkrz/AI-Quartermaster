#!/usr/bin/env node
// @ts-check
import { readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let hasError = false;

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  hasError = true;
}

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

// ── 1. package.json vs package-lock.json bin 엔트리 비교 ────────────────────

const pkgPath = resolve(ROOT, 'package.json');
const lockPath = resolve(ROOT, 'package-lock.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

const pkgBin = pkg.bin ?? {};
const lockBin = lock.packages?.['']?.bin ?? {};

const pkgBinKeys = Object.keys(pkgBin).sort();
const lockBinKeys = Object.keys(lockBin).sort();

if (JSON.stringify(pkgBinKeys) !== JSON.stringify(lockBinKeys)) {
  fail(
    `bin 키 불일치 — package.json: [${pkgBinKeys.join(', ')}], package-lock.json: [${lockBinKeys.join(', ')}]`
  );
} else {
  let valuesMismatch = false;
  for (const key of pkgBinKeys) {
    if (pkgBin[key] !== lockBin[key]) {
      fail(`bin["${key}"] 값 불일치 — package.json: "${pkgBin[key]}", package-lock.json: "${lockBin[key]}"`);
      valuesMismatch = true;
    }
  }
  if (!valuesMismatch) {
    pass(`bin 엔트리 일치 (${pkgBinKeys.map(k => `${k}=${pkgBin[k]}`).join(', ')})`);
  }
}

// ── 2. npm pack --dry-run 으로 bin/aqm 포함 여부 확인 ──────────────────────

let packFiles = /** @type {{ path: string; size: number; mode: number }[]} */ ([]);
try {
  const packJson = execSync('npm pack --dry-run --json', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(packJson);
  packFiles = parsed[0]?.files ?? [];
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`npm pack --dry-run --json 실행 실패: ${message}`);
}

if (packFiles.length > 0) {
  const binEntry = packFiles.find(f => f.path === 'bin/aqm');
  if (binEntry) {
    pass('npm pack 결과물에 bin/aqm 포함됨');
  } else {
    fail('npm pack 결과물에 bin/aqm 미포함 — package.json "files" 필드 확인 필요');
  }
}

// ── 3. bin/aqm 파일 실행 권한 검증 ──────────────────────────────────────────

const binAqmPath = resolve(ROOT, 'bin', 'aqm');
try {
  const stat = statSync(binAqmPath);
  // mode 하위 12비트에서 퍼미션 추출
  const mode = stat.mode & 0o7777;
  // owner execute bit (0o100) 이상 설정되어 있는지 확인
  const ownerExecutable = (mode & 0o100) !== 0;
  if (ownerExecutable) {
    pass(`bin/aqm 실행 권한 확인 (mode: 0${mode.toString(8)})`);
  } else {
    fail(`bin/aqm 실행 권한 없음 (mode: 0${mode.toString(8)}) — chmod +x bin/aqm 필요`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`bin/aqm 파일 접근 실패: ${message}`);
}

// ── 결과 ────────────────────────────────────────────────────────────────────

if (hasError) {
  console.error('\n패키지 정합성 검증 실패.');
  process.exit(1);
} else {
  console.log('\n패키지 정합성 검증 통과.');
}
