import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getCached,
  setCached,
  clearCache,
  getCacheSize,
  hasCached,
  deleteCached,
  evictExpired,
  memoize,
} from "../../src/github/github-cache.js";

describe("github-cache", () => {
  beforeEach(() => {
    // 각 테스트 전에 캐시를 정리합니다
    clearCache();
  });

  describe("setCached and getCached", () => {
    it("should store and retrieve values with type safety", () => {
      const testValue = { id: 1, name: "test" };
      setCached<{ id: number; name: string }>("test-key", testValue);

      const retrieved = getCached<{ id: number; name: string }>("test-key");
      expect(retrieved).toEqual(testValue);
    });

    it("should return undefined for non-existent keys", () => {
      const result = getCached<string>("non-existent");
      expect(result).toBeUndefined();
    });

    it("should handle different data types", () => {
      // String
      setCached("string-key", "hello world");
      expect(getCached<string>("string-key")).toBe("hello world");

      // Number
      setCached("number-key", 42);
      expect(getCached<number>("number-key")).toBe(42);

      // Boolean
      setCached("boolean-key", true);
      expect(getCached<boolean>("boolean-key")).toBe(true);

      // Array
      setCached("array-key", [1, 2, 3]);
      expect(getCached<number[]>("array-key")).toEqual([1, 2, 3]);

      // Object
      const obj = { foo: "bar", nested: { value: 123 } };
      setCached("object-key", obj);
      expect(getCached<typeof obj>("object-key")).toEqual(obj);
    });

    it("should overwrite existing values", () => {
      setCached("key", "first value");
      setCached("key", "second value");

      expect(getCached<string>("key")).toBe("second value");
    });
  });

  describe("clearCache", () => {
    it("should clear all cached items", () => {
      setCached("key1", "value1");
      setCached("key2", "value2");
      setCached("key3", "value3");

      expect(getCacheSize()).toBe(3);

      clearCache();

      expect(getCacheSize()).toBe(0);
      expect(getCached<string>("key1")).toBeUndefined();
      expect(getCached<string>("key2")).toBeUndefined();
      expect(getCached<string>("key3")).toBeUndefined();
    });

    it("should work on empty cache", () => {
      expect(getCacheSize()).toBe(0);
      clearCache();
      expect(getCacheSize()).toBe(0);
    });
  });

  describe("getCacheSize", () => {
    it("should return correct size", () => {
      expect(getCacheSize()).toBe(0);

      setCached("key1", "value1");
      expect(getCacheSize()).toBe(1);

      setCached("key2", "value2");
      expect(getCacheSize()).toBe(2);

      setCached("key1", "updated value"); // 덮어쓰기 - 크기는 그대로
      expect(getCacheSize()).toBe(2);
    });
  });

  describe("hasCached", () => {
    it("should return true for existing keys", () => {
      setCached("existing-key", "some value");
      expect(hasCached("existing-key")).toBe(true);
    });

    it("should return false for non-existent keys", () => {
      expect(hasCached("non-existent-key")).toBe(false);
    });

    it("should return true even for undefined values", () => {
      setCached("undefined-key", undefined);
      expect(hasCached("undefined-key")).toBe(true);
      expect(getCached("undefined-key")).toBeUndefined();
    });
  });

  describe("deleteCached", () => {
    it("should delete existing keys and return true", () => {
      setCached("to-delete", "value");
      expect(hasCached("to-delete")).toBe(true);

      const deleted = deleteCached("to-delete");

      expect(deleted).toBe(true);
      expect(hasCached("to-delete")).toBe(false);
      expect(getCached<string>("to-delete")).toBeUndefined();
    });

    it("should return false for non-existent keys", () => {
      const deleted = deleteCached("non-existent");
      expect(deleted).toBe(false);
    });

    it("should not affect other cached items", () => {
      setCached("keep1", "value1");
      setCached("delete-me", "delete this");
      setCached("keep2", "value2");

      expect(getCacheSize()).toBe(3);

      deleteCached("delete-me");

      expect(getCacheSize()).toBe(2);
      expect(getCached<string>("keep1")).toBe("value1");
      expect(getCached<string>("keep2")).toBe("value2");
      expect(getCached<string>("delete-me")).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle empty string as key", () => {
      setCached("", "empty key value");
      expect(getCached<string>("")).toBe("empty key value");
      expect(hasCached("")).toBe(true);
    });

    it("should handle special characters in keys", () => {
      const specialKey = "repo/owner#123:issue-data";
      setCached(specialKey, { issue: "data" });
      expect(getCached<{ issue: string }>(specialKey)).toEqual({ issue: "data" });
    });

    it("should handle null values", () => {
      setCached("null-key", null);
      expect(getCached("null-key")).toBe(null);
      expect(hasCached("null-key")).toBe(true);
    });

    it("should maintain type safety across different types", () => {
      interface User {
        id: number;
        name: string;
        email?: string;
      }

      const user: User = { id: 1, name: "John" };
      setCached<User>("user", user);

      const retrievedUser = getCached<User>("user");
      expect(retrievedUser).toEqual(user);
      expect(retrievedUser?.id).toBe(1);
      expect(retrievedUser?.name).toBe("John");
    });
  });

  describe("TTL (Time-To-Live)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return value before TTL expires", () => {
      setCached("ttl-key", "value", 1000);
      vi.advanceTimersByTime(999);
      expect(getCached<string>("ttl-key")).toBe("value");
    });

    it("should return undefined after TTL expires", () => {
      setCached("ttl-key", "value", 1000);
      vi.advanceTimersByTime(1001);
      expect(getCached<string>("ttl-key")).toBeUndefined();
    });

    it("hasCached should return false for expired entry", () => {
      setCached("ttl-key", "value", 500);
      vi.advanceTimersByTime(501);
      expect(hasCached("ttl-key")).toBe(false);
    });

    it("expired entry should be removed from cache after getCached", () => {
      setCached("ttl-key", "value", 500);
      vi.advanceTimersByTime(501);
      getCached("ttl-key");
      expect(getCacheSize()).toBe(0);
    });

    it("no TTL means never expires", () => {
      setCached("no-ttl", "value");
      vi.advanceTimersByTime(999_999_999);
      expect(getCached<string>("no-ttl")).toBe("value");
    });
  });

  describe("evictExpired", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should remove expired entries and return count", () => {
      setCached("exp1", "v1", 500);
      setCached("exp2", "v2", 500);
      setCached("keep", "v3", 2000);

      vi.advanceTimersByTime(600);

      const removed = evictExpired();
      expect(removed).toBe(2);
      expect(getCacheSize()).toBe(1);
      expect(getCached<string>("keep")).toBe("v3");
    });

    it("should return 0 when no entries are expired", () => {
      setCached("key1", "value1");
      setCached("key2", "value2", 1000);

      const removed = evictExpired();
      expect(removed).toBe(0);
      expect(getCacheSize()).toBe(2);
    });

    it("should return 0 on empty cache", () => {
      expect(evictExpired()).toBe(0);
    });
  });

  describe("memoize", () => {
    beforeEach(() => {
      clearCache();
    });

    it("should return cached result on second call", async () => {
      let callCount = 0;
      const fn = memoize(async (id: number) => {
        callCount++;
        return { id, name: "item" };
      });

      const r1 = await fn(1);
      const r2 = await fn(1);

      expect(r1).toEqual({ id: 1, name: "item" });
      expect(r2).toEqual({ id: 1, name: "item" });
      expect(callCount).toBe(1);
    });

    it("should call fn separately for different args", async () => {
      let callCount = 0;
      const fn = memoize(async (id: number) => {
        callCount++;
        return id * 2;
      });

      await fn(1);
      await fn(2);
      await fn(1);

      expect(callCount).toBe(2);
    });

    it("should not cache errors", async () => {
      let callCount = 0;
      const fn = memoize(async (id: number) => {
        callCount++;
        if (callCount === 1) throw new Error("transient error");
        return id;
      });

      await expect(fn(1)).rejects.toThrow("transient error");
      const result = await fn(1);
      expect(result).toBe(1);
      expect(callCount).toBe(2);
    });

    it("should deduplicate concurrent in-flight calls", async () => {
      let callCount = 0;
      const fn = memoize(async (id: number) => {
        callCount++;
        await Promise.resolve();
        return id;
      });

      const [r1, r2, r3] = await Promise.all([fn(5), fn(5), fn(5)]);

      expect(r1).toBe(5);
      expect(r2).toBe(5);
      expect(r3).toBe(5);
      expect(callCount).toBe(1);
    });

    it("should respect TTL option", async () => {
      vi.useFakeTimers();
      try {
        let callCount = 0;
        const fn = memoize(async () => {
          callCount++;
          return "value";
        }, { ttl: 1000 });

        await fn();
        vi.advanceTimersByTime(1001);
        await fn();

        expect(callCount).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should use custom keyFn", async () => {
      let callCount = 0;
      const fn = memoize(
        async (a: number, b: number) => {
          callCount++;
          return a + b;
        },
        { keyFn: (a, b) => `${a}+${b}` },
      );

      const r1 = await fn(1, 2);
      const r2 = await fn(1, 2);

      expect(r1).toBe(3);
      expect(r2).toBe(3);
      expect(callCount).toBe(1);
    });
  });

  describe("integration scenarios", () => {
    it("should simulate GitHub issue caching scenario", () => {
      // Simulate caching GitHub issue data
      const issueData = {
        number: 123,
        title: "Fix login bug",
        body: "The login form is broken",
        labels: ["bug", "priority-high"]
      };

      const cacheKey = "github:issue:owner/repo:123";

      // First call - cache miss
      expect(getCached(cacheKey)).toBeUndefined();

      // Cache the result
      setCached(cacheKey, issueData);

      // Second call - cache hit
      const cached = getCached<typeof issueData>(cacheKey);
      expect(cached).toEqual(issueData);
      expect(cached?.number).toBe(123);
    });

    it("should handle multiple issue caching", () => {
      const issues = [
        { number: 1, title: "Issue 1" },
        { number: 2, title: "Issue 2" },
        { number: 3, title: "Issue 3" }
      ];

      // Cache multiple issues
      issues.forEach(issue => {
        setCached(`issue:${issue.number}`, issue);
      });

      expect(getCacheSize()).toBe(3);

      // Verify all issues are cached correctly
      issues.forEach(issue => {
        const cached = getCached<typeof issue>(`issue:${issue.number}`);
        expect(cached).toEqual(issue);
      });
    });

    it("should simulate TTL-aware issue caching (5분 TTL 정책)", () => {
      vi.useFakeTimers();
      try {
        const ISSUE_CACHE_TTL_MS = 5 * 60 * 1000;
        const issueKey = "issue:owner/repo:42";
        const issueData = { number: 42, title: "TTL integration test", body: "", labels: [] };

        // 캐시 저장
        setCached(issueKey, issueData, ISSUE_CACHE_TTL_MS);

        // TTL 이전 — 캐시 히트
        vi.advanceTimersByTime(ISSUE_CACHE_TTL_MS - 1);
        expect(getCached(issueKey)).toEqual(issueData);

        // TTL 경과 — 캐시 미스
        vi.advanceTimersByTime(2);
        expect(getCached(issueKey)).toBeUndefined();
        expect(getCacheSize()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should simulate selective invalidation of issue cache", () => {
      const issue42Key = "issue:owner/repo:42";
      const issue99Key = "issue:owner/repo:99";
      const prKey = "pr:owner/repo:5";

      setCached(issue42Key, { number: 42, title: "Issue 42" });
      setCached(issue99Key, { number: 99, title: "Issue 99" });
      setCached(prKey, { number: 5, title: "PR 5" });

      expect(getCacheSize()).toBe(3);

      // 이슈 42만 무효화
      deleteCached(issue42Key);

      expect(getCached(issue42Key)).toBeUndefined();
      expect(getCached(issue99Key)).toEqual({ number: 99, title: "Issue 99" });
      expect(getCached(prKey)).toEqual({ number: 5, title: "PR 5" });
      expect(getCacheSize()).toBe(2);
    });

    it("should simulate memoize TTL with full pipeline lifecycle", async () => {
      vi.useFakeTimers();
      try {
        const ISSUE_CACHE_TTL_MS = 5 * 60 * 1000;
        let fetchCount = 0;

        const fetchIssueSimulated = memoize(
          async (repo: string, number: number) => {
            fetchCount++;
            return { repo, number, title: `Issue #${number}` };
          },
          {
            ttl: ISSUE_CACHE_TTL_MS,
            keyFn: (repo: string, number: number) => `issue:${repo}:${number}`,
          }
        );

        // 최초 호출 — fetch 실행
        await fetchIssueSimulated("owner/repo", 1);
        expect(fetchCount).toBe(1);

        // TTL 이내 재호출 — 캐시 히트
        vi.advanceTimersByTime(ISSUE_CACHE_TTL_MS - 1);
        await fetchIssueSimulated("owner/repo", 1);
        expect(fetchCount).toBe(1);

        // TTL 경과 후 재호출 — fetch 재실행
        vi.advanceTimersByTime(2);
        await fetchIssueSimulated("owner/repo", 1);
        expect(fetchCount).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});