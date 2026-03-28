import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { PatternStore } from "../../src/learning/pattern-store.js";
import type { PatternEntry } from "../../src/learning/pattern-store.js";

let tmpDir: string;
let store: PatternStore;

beforeEach(() => {
  tmpDir = mkdtempSync(`${tmpdir()}/pattern-store-test-`);
  store = new PatternStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<Omit<PatternEntry, "id" | "timestamp">> = {}): Omit<PatternEntry, "id" | "timestamp"> {
  return {
    issueNumber: 1,
    repo: "test/repo",
    type: "success",
    tags: [],
    ...overrides,
  };
}

describe("PatternStore", () => {
  describe("add", () => {
    it("adds an entry and returns it with id and timestamp", () => {
      const result = store.add(makeEntry());
      expect(result.id).toMatch(/^pat-\d+-[a-z0-9]+$/);
      expect(result.timestamp).toBeTruthy();
      expect(result.issueNumber).toBe(1);
      expect(result.repo).toBe("test/repo");
    });

    it("persists entries across instances", () => {
      store.add(makeEntry({ type: "failure", errorCategory: "TS_ERROR" }));
      const store2 = new PatternStore(tmpDir);
      const entries = store2.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("failure");
    });

    it("truncates errorMessage to 200 characters", () => {
      const longMsg = "x".repeat(300);
      const result = store.add(makeEntry({ errorMessage: longMsg }));
      expect(result.errorMessage).toHaveLength(200);
    });

    it("stores entries newest-first (unshift)", () => {
      store.add(makeEntry({ issueNumber: 1 }));
      store.add(makeEntry({ issueNumber: 2 }));
      const entries = store.list();
      expect(entries[0].issueNumber).toBe(2);
      expect(entries[1].issueNumber).toBe(1);
    });

    it("enforces FIFO rotation at 100 entries", () => {
      for (let i = 0; i < 102; i++) {
        store.add(makeEntry({ issueNumber: i }));
      }
      const entries = store.list();
      expect(entries).toHaveLength(100);
      // oldest entries (issueNumber 0 and 1) should have been dropped
      expect(entries.map(e => e.issueNumber)).not.toContain(0);
      expect(entries.map(e => e.issueNumber)).not.toContain(1);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.add(makeEntry({ type: "success", repo: "test/repo" }));
      store.add(makeEntry({ type: "failure", repo: "test/repo", errorCategory: "TS_ERROR" }));
      store.add(makeEntry({ type: "failure", repo: "other/repo", errorCategory: "TIMEOUT" }));
    });

    it("returns all entries with no filter", () => {
      expect(store.list()).toHaveLength(3);
    });

    it("filters by type", () => {
      const failures = store.list({ type: "failure" });
      expect(failures).toHaveLength(2);
      expect(failures.every(e => e.type === "failure")).toBe(true);
    });

    it("filters by repo", () => {
      const entries = store.list({ repo: "other/repo" });
      expect(entries).toHaveLength(1);
      expect(entries[0].repo).toBe("other/repo");
    });

    it("limits results", () => {
      expect(store.list({ limit: 2 })).toHaveLength(2);
    });

    it("combines type and repo filters", () => {
      const entries = store.list({ type: "failure", repo: "test/repo" });
      expect(entries).toHaveLength(1);
      expect(entries[0].errorCategory).toBe("TS_ERROR");
    });
  });

  describe("getRecentFailures", () => {
    it("returns failures for the given repo", () => {
      store.add(makeEntry({ type: "failure", repo: "test/repo" }));
      store.add(makeEntry({ type: "success", repo: "test/repo" }));
      store.add(makeEntry({ type: "failure", repo: "other/repo" }));

      const failures = store.getRecentFailures("test/repo");
      expect(failures).toHaveLength(1);
      expect(failures[0].repo).toBe("test/repo");
      expect(failures[0].type).toBe("failure");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        store.add(makeEntry({ type: "failure", repo: "test/repo" }));
      }
      expect(store.getRecentFailures("test/repo", 3)).toHaveLength(3);
    });

    it("defaults to limit 5", () => {
      for (let i = 0; i < 8; i++) {
        store.add(makeEntry({ type: "failure", repo: "test/repo" }));
      }
      expect(store.getRecentFailures("test/repo")).toHaveLength(5);
    });
  });

  describe("getStats", () => {
    it("returns correct counts and byCategory", () => {
      store.add(makeEntry({ type: "success", repo: "test/repo" }));
      store.add(makeEntry({ type: "failure", repo: "test/repo", errorCategory: "TS_ERROR" }));
      store.add(makeEntry({ type: "failure", repo: "test/repo", errorCategory: "TS_ERROR" }));
      store.add(makeEntry({ type: "failure", repo: "test/repo", errorCategory: "TIMEOUT" }));

      const stats = store.getStats("test/repo");
      expect(stats.total).toBe(4);
      expect(stats.successes).toBe(1);
      expect(stats.failures).toBe(3);
      expect(stats.byCategory["TS_ERROR"]).toBe(2);
      expect(stats.byCategory["TIMEOUT"]).toBe(1);
    });

    it("returns stats across all repos when no repo given", () => {
      store.add(makeEntry({ type: "success", repo: "a/b" }));
      store.add(makeEntry({ type: "failure", repo: "c/d", errorCategory: "CLI_CRASH" }));

      const stats = store.getStats();
      expect(stats.total).toBe(2);
      expect(stats.successes).toBe(1);
      expect(stats.failures).toBe(1);
    });

    it("returns zeros for empty store", () => {
      const stats = store.getStats();
      expect(stats.total).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.byCategory).toEqual({});
    });
  });

  describe("formatForPrompt", () => {
    it("returns empty string for empty array", () => {
      expect(store.formatForPrompt([])).toBe("");
    });

    it("includes error category and message", () => {
      const entry = store.add(makeEntry({ type: "failure", errorCategory: "TS_ERROR", errorMessage: "Cannot find name 'foo'" }));
      const result = store.formatForPrompt([entry]);
      expect(result).toContain("TS_ERROR");
      expect(result).toContain("Cannot find name 'foo'");
    });

    it("truncates output to 500 characters plus ellipsis", () => {
      const entries: ReturnType<PatternStore["add"]>[] = [];
      for (let i = 0; i < 20; i++) {
        entries.push(store.add(makeEntry({
          type: "failure",
          errorCategory: "UNKNOWN",
          errorMessage: "Some very long error message that takes up space in the output buffer",
        })));
      }
      const result = store.formatForPrompt(entries);
      expect(result.length).toBeLessThanOrEqual(501 + 1); // 500 chars + "…"
      expect(result.endsWith("…")).toBe(true);
    });

    it("does not truncate when output is under 500 chars", () => {
      const entry = store.add(makeEntry({ type: "failure", errorCategory: "TIMEOUT", errorMessage: "timed out" }));
      const result = store.formatForPrompt([entry]);
      expect(result.endsWith("…")).toBe(false);
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it("uses resolutionHint when no resolution provided", () => {
      const entry = store.add(makeEntry({ type: "failure", errorCategory: "TS_ERROR" }));
      const result = store.formatForPrompt([entry]);
      expect(result).toContain("import");
    });

    it("uses provided resolution over hint", () => {
      const entry = store.add(makeEntry({ type: "failure", errorCategory: "TS_ERROR", resolution: "Check exports" }));
      const result = store.formatForPrompt([entry]);
      expect(result).toContain("Check exports");
    });
  });
});
