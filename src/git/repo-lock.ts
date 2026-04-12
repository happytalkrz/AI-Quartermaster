import { resolve } from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { AQM_HOME } from '../config/project-resolver.js';

const LOCKS_DIR = resolve(AQM_HOME, 'locks');

function repoToSlug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 같은 프로세스 내 직렬화용 큐 */
const inProcessQueues = new Map<string, Promise<void>>();

async function ensureLocksDir(): Promise<void> {
  await mkdir(LOCKS_DIR, { recursive: true });
}

/**
 * O_EXCL 원자적 생성으로 파일 락을 획득한다.
 * 다른 프로세스가 락을 보유 중이면 폴링으로 대기한다.
 */
async function acquireFlockFile(lockPath: string): Promise<() => Promise<void>> {
  const MAX_RETRIES = 50;
  const BASE_DELAY_MS = 50;
  const MAX_DELAY_MS = 500;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
      await fd.close();
      return async () => {
        try { await unlink(lockPath); } catch { /* 이미 삭제된 경우 무시 */ }
      };
    } catch {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Timeout: could not acquire repo lock at ${lockPath}`);
      }
      const delay = Math.min(BASE_DELAY_MS + attempt * 15, MAX_DELAY_MS);
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  await ensureLocksDir();
  const slug = repoToSlug(repo);
  const lockPath = resolve(LOCKS_DIR, `${slug}.flock`);

  // 같은 프로세스 내에서는 promise 체인으로 직렬화
  const prev = inProcessQueues.get(slug) ?? Promise.resolve();
  let signalDone!: () => void;
  const done = new Promise<void>(r => { signalDone = r; });
  inProcessQueues.set(slug, done);

  try {
    await prev.catch(() => {}); // 이전 보유자가 끝날 때까지 대기 (에러 무시)
    const releaseFile = await acquireFlockFile(lockPath);
    try {
      return await fn();
    } finally {
      await releaseFile();
    }
  } finally {
    signalDone();
    if (inProcessQueues.get(slug) === done) {
      inProcessQueues.delete(slug);
    }
  }
}
