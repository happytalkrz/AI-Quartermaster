import { describe, it, expect } from "vitest";
import { withRepoLock } from "../../src/git/repo-lock.js";

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
    expect(order).toEqual([1, 2, 3]);
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
});
