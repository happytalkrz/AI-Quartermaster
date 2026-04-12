import { lock } from 'proper-lockfile';
import { resolve } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { AQM_HOME } from '../config/project-resolver.js';

const LOCKS_DIR = resolve(AQM_HOME, 'locks');

function repoToSlug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function ensureLockFile(file: string): Promise<void> {
  await mkdir(LOCKS_DIR, { recursive: true });
  try {
    await access(file);
  } catch {
    await writeFile(file, '');
  }
}

export async function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = resolve(LOCKS_DIR, repoToSlug(repo));
  await ensureLockFile(lockFile);

  const release = await lock(lockFile, {
    retries: { retries: 20, minTimeout: 50, maxTimeout: 500 },
    realpath: false,
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}
