import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/github/github-cache.js", async () => {
  return await vi.importActual("../../src/github/github-cache.js");
});

import { fetchIssue, fetchPR, invalidateIssueCache, invalidatePRCache } from "../../src/github/issue-fetcher.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { clearCache } from "../../src/github/github-cache.js";

const mockRunCli = vi.mocked(runCli);

describe("fetchIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  it("should fetch issue successfully with basic options", async () => {
    const mockResponse = {
      number: 123,
      title: "Fix login bug",
      body: "The login form is broken",
      labels: [
        { name: "bug" },
        { name: "priority-high" }
      ]
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 123);

    expect(result).toEqual({
      number: 123,
      title: "Fix login bug",
      body: "The login form is broken",
      labels: ["bug", "priority-high"]
    });

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "123", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: undefined }
    );
  });

  it("should handle string labels format", async () => {
    const mockResponse = {
      number: 456,
      title: "Update docs",
      body: "Documentation needs updating",
      labels: ["documentation", "enhancement"]
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 456);

    expect(result).toEqual({
      number: 456,
      title: "Update docs",
      body: "Documentation needs updating",
      labels: ["documentation", "enhancement"]
    });
  });

  it("should handle mixed labels format", async () => {
    const mockResponse = {
      number: 789,
      title: "Mixed labels test",
      body: "Testing mixed label formats",
      labels: [
        "bug",
        { name: "priority-low" },
        "feature-request"
      ]
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 789);

    expect(result).toEqual({
      number: 789,
      title: "Mixed labels test",
      body: "Testing mixed label formats",
      labels: ["bug", "priority-low", "feature-request"]
    });
  });

  it("should use custom gh path when provided", async () => {
    const mockResponse = {
      number: 100,
      title: "Custom gh test",
      body: "Testing custom gh path",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchIssue("test/repo", 100, { ghPath: "/custom/gh" });

    expect(mockRunCli).toHaveBeenCalledWith(
      "/custom/gh",
      ["issue", "view", "100", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: undefined }
    );
  });

  it("should pass timeout option to runCli", async () => {
    const mockResponse = {
      number: 200,
      title: "Timeout test",
      body: "Testing timeout option",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchIssue("test/repo", 200, { timeout: 5000 });

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "200", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: 5000 }
    );
  });

  it("should pass both ghPath and timeout options", async () => {
    const mockResponse = {
      number: 300,
      title: "Both options test",
      body: "Testing both options",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchIssue("test/repo", 300, {
      ghPath: "/usr/local/bin/gh",
      timeout: 10000
    });

    expect(mockRunCli).toHaveBeenCalledWith(
      "/usr/local/bin/gh",
      ["issue", "view", "300", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: 10000 }
    );
  });

  it("should throw error when gh CLI fails", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "Issue not found",
      exitCode: 1
    });

    await expect(fetchIssue("test/repo", 404)).rejects.toThrow(
      "Failed to fetch issue #404 from test/repo: GitHub issue view failed: Resource not found"
    );
  });

  it("should include stdout in error message when stderr is empty", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "Error: repository 'invalid/repo' not found",
      stderr: "",
      exitCode: 1
    });

    await expect(fetchIssue("invalid/repo", 123)).rejects.toThrow(
      "Failed to fetch issue #123 from invalid/repo: GitHub issue view failed: Resource not found"
    );
  });

  it("should throw error when JSON parsing fails", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "not valid json",
      stderr: "",
      exitCode: 0
    });

    await expect(fetchIssue("test/repo", 123)).rejects.toThrow(
      "Failed to parse gh output for issue #123: not valid json"
    );
  });

  it("should throw error when JSON parsing fails with complex invalid JSON", async () => {
    mockRunCli.mockResolvedValue({
      stdout: '{"number": 123, "title": "Test", "invalid": }',
      stderr: "",
      exitCode: 0
    });

    await expect(fetchIssue("test/repo", 123)).rejects.toThrow(
      'Failed to parse gh output for issue #123: {"number": 123, "title": "Test", "invalid": }'
    );
  });

  it("should handle empty labels array", async () => {
    const mockResponse = {
      number: 500,
      title: "No labels test",
      body: "Issue without labels",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 500);

    expect(result).toEqual({
      number: 500,
      title: "No labels test",
      body: "Issue without labels",
      labels: []
    });
  });

  it("should handle undefined options", async () => {
    const mockResponse = {
      number: 600,
      title: "No options test",
      body: "Testing without options",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 600, undefined);

    expect(result).toEqual({
      number: 600,
      title: "No options test",
      body: "Testing without options",
      labels: []
    });

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "600", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: undefined }
    );
  });

  it("should handle complex repository names", async () => {
    const mockResponse = {
      number: 700,
      title: "Complex repo test",
      body: "Testing complex repository names",
      labels: ["test"]
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchIssue("org-name/repo-with-dashes_and_underscores", 700);

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "700", "--repo", "org-name/repo-with-dashes_and_underscores", "--json", "number,title,body,labels"],
      { timeout: undefined }
    );
  });

  it("should handle large issue numbers", async () => {
    const mockResponse = {
      number: 999999,
      title: "Large number test",
      body: "Testing large issue numbers",
      labels: []
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchIssue("test/repo", 999999);

    expect(result.number).toBe(999999);
    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "999999", "--repo", "test/repo", "--json", "number,title,body,labels"],
      { timeout: undefined }
    );
  });

  describe("TTL 캐시 만료", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should re-fetch after TTL (5 minutes) expires", async () => {
      const mockResponse = {
        number: 1001,
        title: "TTL test issue",
        body: "Testing TTL expiration",
        labels: []
      };
      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0
      });

      await fetchIssue("test/repo", 1001);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // 두 번째 호출 — TTL 이전이므로 캐시 히트
      await fetchIssue("test/repo", 1001);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // TTL(5분) 경과 후 재호출
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await fetchIssue("test/repo", 1001);
      expect(mockRunCli).toHaveBeenCalledTimes(2);
    });

    it("should not re-fetch before TTL expires", async () => {
      const mockResponse = {
        number: 1002,
        title: "TTL not expired test",
        body: "Cache should still be valid",
        labels: []
      };
      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0
      });

      await fetchIssue("test/repo", 1002);
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      await fetchIssue("test/repo", 1002);

      expect(mockRunCli).toHaveBeenCalledTimes(1);
    });
  });

  describe("캐시 선택적 무효화 — invalidateIssueCache", () => {
    it("should re-fetch after invalidateIssueCache is called", async () => {
      const mockResponse = {
        number: 1003,
        title: "Invalidation test",
        body: "Testing cache invalidation",
        labels: []
      };
      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: "",
        exitCode: 0
      });

      // 첫 번째 호출 — runCli 실행
      await fetchIssue("test/repo", 1003);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // 두 번째 호출 — 캐시 히트, runCli 미실행
      await fetchIssue("test/repo", 1003);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // 캐시 무효화 후 재호출 — runCli 재실행
      invalidateIssueCache("test/repo", 1003);
      await fetchIssue("test/repo", 1003);
      expect(mockRunCli).toHaveBeenCalledTimes(2);
    });

    it("should only invalidate the specified issue, not others", async () => {
      mockRunCli
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ number: 1004, title: "Issue A", body: "", labels: [] }),
          stderr: "",
          exitCode: 0
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ number: 1005, title: "Issue B", body: "", labels: [] }),
          stderr: "",
          exitCode: 0
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ number: 1004, title: "Issue A updated", body: "", labels: [] }),
          stderr: "",
          exitCode: 0
        });

      await fetchIssue("test/repo", 1004);
      await fetchIssue("test/repo", 1005);
      expect(mockRunCli).toHaveBeenCalledTimes(2);

      // 1004만 무효화
      invalidateIssueCache("test/repo", 1004);

      // 1004는 재요청, 1005는 캐시 히트
      await fetchIssue("test/repo", 1004);
      await fetchIssue("test/repo", 1005);
      expect(mockRunCli).toHaveBeenCalledTimes(3);
    });
  });

  describe("캐시 선택적 무효화 — invalidatePRCache", () => {
    it("should re-fetch PR after invalidatePRCache is called", async () => {
      const mockPRResponse = {
        number: 10,
        title: "PR title",
        body: "PR body",
        state: "open",
        headRefName: "feature-branch",
        headRefOid: "abc123def456",
        baseRefName: "main"
      };
      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockPRResponse),
        stderr: "",
        exitCode: 0
      });

      // 첫 번째 호출 — runCli 실행
      await fetchPR("test/repo", 10);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // 두 번째 호출 — 캐시 히트
      await fetchPR("test/repo", 10);
      expect(mockRunCli).toHaveBeenCalledTimes(1);

      // PR 캐시 무효화 후 재호출
      invalidatePRCache("test/repo", 10);
      await fetchPR("test/repo", 10);
      expect(mockRunCli).toHaveBeenCalledTimes(2);
    });

    it("invalidatePRCache should not affect issue cache", async () => {
      mockRunCli
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ number: 1006, title: "Issue", body: "", labels: [] }),
          stderr: "",
          exitCode: 0
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 11, title: "PR", body: "", state: "open",
            headRefName: "feat", headRefOid: "sha", baseRefName: "main"
          }),
          stderr: "",
          exitCode: 0
        });

      await fetchIssue("test/repo", 1006);
      await fetchPR("test/repo", 11);
      expect(mockRunCli).toHaveBeenCalledTimes(2);

      // PR 캐시만 무효화
      invalidatePRCache("test/repo", 11);

      // 이슈는 여전히 캐시 히트
      await fetchIssue("test/repo", 1006);
      expect(mockRunCli).toHaveBeenCalledTimes(2);
    });
  });

});