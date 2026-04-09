import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getCached,
  setCached,
  clearCache,
  getCacheSize,
  hasCached,
  deleteCached,
  evictExpired
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
  });
});