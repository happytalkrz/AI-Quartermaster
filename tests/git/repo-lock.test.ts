import { describe, it, expect, afterAll } from "vitest";
import { withRepoLock } from "../../src/git/repo-lock.js";
import { AQM_HOME } from "../../src/config/project-resolver.js";
import { rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import lockfile from "proper-lockfile";

const LOCKS_DIR = resolve(AQM_HOME, "locks");

function repoToSlug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const TEST_REPOS = ["repo-a", "repo-b", "repo-c", "repo-d", "repo-e"];

afterAll(async () => {
  await Promise.all(
    TEST_REPOS.map((repo) =>
      rm(resolve(LOCKS_DIR, repoToSlug(repo)), { force: true })
    )
  );
});

describe("withRepoLock", () => {
  it("serializes execution for the same repo", async () => {
    const order: number[] = [];
    const p1 = withRepoLock("repo-a", async () => {
      order.push(1);
      await new Promise(r => setTimeout(r, 50));
      order.push(2);
    });
    const p2 = withRepoLock("repo-a", async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    // proper-lockfile does not guarantee FIFO: either p1 or p2 may win the lock first.
    // What matters is that executions don't interleave: 1 and 2 must be adjacent.
    const idx1 = order.indexOf(1);
    const idx2 = order.indexOf(2);
    expect(order).toHaveLength(3);
    expect(idx2).toBe(idx1 + 1);
  });

  it("allows parallel execution for different repos", async () => {
    const order: string[] = [];
    const p1 = withRepoLock("repo-a", async () => {
      order.push("a-start");
      await new Promise(r => setTimeout(r, 50));
      order.push("a-end");
    });
    const p2 = withRepoLock("repo-b", async () => {
      order.push("b-start");
      await new Promise(r => setTimeout(r, 10));
      order.push("b-end");
    });
    await Promise.all([p1, p2]);
    expect(order).toContain("a-start");
    expect(order).toContain("b-start");
    // b should finish before a since it has shorter delay
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  it("releases lock on exception", async () => {
    let secondRan = false;
    try {
      await withRepoLock("repo-c", async () => {
        throw new Error("boom");
      });
    } catch { /* expected */ }

    await withRepoLock("repo-c", async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });

  it("queued waiters continue after exception in predecessor", async () => {
    const results: string[] = [];
    const p1 = withRepoLock("repo-d", async () => {
      throw new Error("first fails");
    }).catch(() => results.push("p1-failed"));

    const p2 = withRepoLock("repo-d", async () => {
      results.push("p2-ok");
    });

    await Promise.all([p1, p2]);
    expect(results).toContain("p1-failed");
    expect(results).toContain("p2-ok");
  });

  it("returns the function result", async () => {
    const result = await withRepoLock("repo-e", async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it("multiprocess: blocks another process while lock is held", async () => {
    const tmpDir = resolve(tmpdir(), `aqm-mp-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    const lockFilePath = resolve(tmpDir, "mp-repo");
    const resultFile = resolve(tmpDir, "result.txt");
    await writeFile(lockFilePath, "");

    // Child script runs via --input-type=module stdin so module resolution
    // uses process.cwd() (project root), where node_modules/proper-lockfile lives.
    const childScript = `
import lockfile from 'proper-lockfile';
import { writeFile } from 'node:fs/promises';
const release = await lockfile.lock(${JSON.stringify(lockFilePath)}, {
  retries: { retries: 30, minTimeout: 50, maxTimeout: 300 },
  realpath: false,
});
await writeFile(${JSON.stringify(resultFile)}, String(Date.now()));
await release();
`;

    const HOLD_MS = 300;
    const startTime = Date.now();

    // Parent acquires lock directly via proper-lockfile
    const release = await lockfile.lock(lockFilePath, { realpath: false });

    // Spawn child while parent holds the lock — child must wait
    const child = spawn("node", ["--input-type=module"], {
      stdio: ["pipe", "ignore", "ignore"],
      cwd: process.cwd(),
    });
    child.stdin!.write(childScript);
    child.stdin!.end();

    await new Promise<void>((r) => setTimeout(r, HOLD_MS));
    await release();

    // Wait for child to finish
    await new Promise<void>((res, rej) => {
      child.on("close", (code) =>
        code === 0 ? res() : rej(new Error(`Child exited with code ${code}`))
      );
      setTimeout(() => rej(new Error("Child timed out")), 5000);
    });

    const childAcquiredAt = parseInt(await readFile(resultFile, "utf8"));
    // Child should have acquired the lock no earlier than ~HOLD_MS after start
    expect(childAcquiredAt - startTime).toBeGreaterThanOrEqual(HOLD_MS - 50);

    await rm(tmpDir, { recursive: true, force: true });
  }, 10000);
});
