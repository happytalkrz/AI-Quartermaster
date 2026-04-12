import { describe, it, expect, afterAll } from "vitest";
import { withRepoLock } from "../../src/git/repo-lock.js";
import { AQM_HOME } from "../../src/config/project-resolver.js";
import { rm, writeFile, readFile, mkdir, open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const LOCKS_DIR = resolve(AQM_HOME, "locks");

function repoToSlug(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const TEST_REPOS = ["repo-a", "repo-b", "repo-c", "repo-d", "repo-e"];

afterAll(async () => {
  await Promise.all(
    TEST_REPOS.map((repo) =>
      rm(resolve(LOCKS_DIR, `${repoToSlug(repo)}.flock`), { force: true })
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
    // in-process 큐는 FIFO를 보장하므로 p1이 먼저 실행된다.
    // 핵심: 1과 2는 인터리브되지 않고 연속으로 붙어 있어야 한다.
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

    const flockPath = resolve(tmpDir, "mp-repo.flock");
    const resultFile = resolve(tmpDir, "result.txt");

    // Child script: O_EXCL 기반 flock으로 락 획득 후 타임스탬프 기록
    const childScript = `
import { open, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';

const lockPath = ${JSON.stringify(flockPath)};
const MAX_ATTEMPTS = 60;
for (let i = 0; i < MAX_ATTEMPTS; i++) {
  try {
    const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
    await fd.close();
    await writeFile(${JSON.stringify(resultFile)}, String(Date.now()));
    try { await unlink(lockPath); } catch { /* cleanup */ }
    process.exit(0);
  } catch {
    await new Promise(r => setTimeout(r, 50 + i * 10));
  }
}
process.exit(1);
`;

    const HOLD_MS = 300;
    const startTime = Date.now();

    // 부모 프로세스가 O_EXCL로 락 파일 선점
    const fd = await open(flockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
    await fd.close();

    // 부모가 락을 보유하는 동안 자식 프로세스 실행 — 자식은 대기해야 함
    const child = spawn("node", ["--input-type=module"], {
      stdio: ["pipe", "ignore", "ignore"],
      cwd: process.cwd(),
    });
    child.stdin!.write(childScript);
    child.stdin!.end();

    await new Promise<void>((r) => setTimeout(r, HOLD_MS));

    // 부모가 락 해제
    try { await unlink(flockPath); } catch { /* cleanup */ }

    // 자식이 완료될 때까지 대기
    await new Promise<void>((res, rej) => {
      child.on("close", (code) =>
        code === 0 ? res() : rej(new Error(`Child exited with code ${code}`))
      );
      setTimeout(() => rej(new Error("Child timed out")), 5000);
    });

    const childAcquiredAt = parseInt(await readFile(resultFile, "utf8"));
    // 자식은 부모가 락을 해제한 후(~HOLD_MS 이후)에야 획득할 수 있어야 함
    expect(childAcquiredAt - startTime).toBeGreaterThanOrEqual(HOLD_MS - 50);

    await rm(tmpDir, { recursive: true, force: true });
  }, 10000);
});
