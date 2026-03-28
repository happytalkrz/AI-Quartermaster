const queues = new Map<string, Array<() => void>>();
const locked = new Set<string>();

export async function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  // Wait until the lock is free
  if (locked.has(repo)) {
    await new Promise<void>(resolve => {
      if (!queues.has(repo)) {
        queues.set(repo, []);
      }
      queues.get(repo)!.push(resolve);
    });
  }

  locked.add(repo);
  try {
    return await fn();
  } finally {
    locked.delete(repo);
    // Wake next waiter, if any
    const queue = queues.get(repo);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) {
        queues.delete(repo);
      }
      next();
    }
  }
}
