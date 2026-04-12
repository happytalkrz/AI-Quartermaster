import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/github/github-cache.js", () => ({
  memoize: vi.fn((fn) => fn), // Mock memoize to return the original function
  getCached: vi.fn(),
  setCached: vi.fn(),
  clearCache: vi.fn(),
}));

import { fetchIssue, fetchPR } from "../../src/github/issue-fetcher.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { getCached, setCached } from "../../src/github/github-cache.js";

const mockRunCli = vi.mocked(runCli);
const mockGetCached = vi.mocked(getCached);
const mockSetCached = vi.mocked(setCached);

describe("fetchIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본적으로 캐시 미스 상태로 설정
    mockGetCached.mockReturnValue(undefined);
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

  it("should throw auth error when 401 authentication required", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "HTTP 401: authentication required",
      exitCode: 1
    });

    await expect(fetchIssue("test/repo", 1)).rejects.toThrow(
      "Failed to fetch issue #1 from test/repo: GitHub issue view failed: Authentication required"
    );
  });

  it("should throw auth error when stderr contains authentication required text", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "authentication required - please run gh auth login",
      exitCode: 1
    });

    await expect(fetchIssue("test/repo", 1)).rejects.toThrow(
      "Failed to fetch issue #1 from test/repo: GitHub issue view failed: Authentication required"
    );
  });

  it("should throw permission error when 403 forbidden", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "HTTP 403: Forbidden",
      exitCode: 1
    });

    await expect(fetchIssue("private/repo", 42)).rejects.toThrow(
      "Failed to fetch issue #42 from private/repo: GitHub issue view failed: Permission denied"
    );
  });

  it("should throw rate limit error when rate limit exceeded", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "rate limit exceeded, try again later",
      exitCode: 1
    });

    await expect(fetchIssue("test/repo", 10)).rejects.toThrow(
      "Failed to fetch issue #10 from test/repo: GitHub issue view failed: Rate limit exceeded"
    );
  });

  it("should throw rate limit error when HTTP 429 response", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "HTTP 429: too many requests",
      exitCode: 1
    });

    await expect(fetchIssue("test/repo", 10)).rejects.toThrow(
      "Failed to fetch issue #10 from test/repo: GitHub issue view failed: Rate limit exceeded"
    );
  });

  it("should throw error when network timeout occurs", async () => {
    mockRunCli.mockRejectedValue(new Error("ETIMEDOUT: connection timed out"));

    await expect(fetchIssue("test/repo", 5, { timeout: 1000 })).rejects.toThrow(
      "ETIMEDOUT: connection timed out"
    );
  });

  it("should throw not found error when accessing deleted repository", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "Could not resolve to a Repository with the name 'deleted/repo'. HTTP 404: not found",
      exitCode: 1
    });

    await expect(fetchIssue("deleted/repo", 1)).rejects.toThrow(
      "Failed to fetch issue #1 from deleted/repo: GitHub issue view failed: Resource not found"
    );
  });

});

describe("fetchPR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(undefined);
  });

  it("should fetch PR successfully with all fields", async () => {
    const mockResponse = {
      number: 42,
      title: "Add new feature",
      body: "This PR adds a new feature",
      state: "OPEN",
      headRefName: "feature/new-feature",
      headRefOid: "abc123def456",
      baseRefName: "main"
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchPR("test/repo", 42);

    expect(result).toEqual({
      number: 42,
      title: "Add new feature",
      body: "This PR adds a new feature",
      state: "OPEN",
      head: {
        ref: "feature/new-feature",
        sha: "abc123def456"
      },
      base: {
        ref: "main"
      }
    });

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "42", "--repo", "test/repo", "--json", "number,title,body,state,headRefName,headRefOid,baseRefName"],
      { timeout: undefined }
    );
  });

  it("should fetch closed PR", async () => {
    const mockResponse = {
      number: 10,
      title: "Old PR",
      body: "Already merged",
      state: "CLOSED",
      headRefName: "old-branch",
      headRefOid: "deadbeef1234",
      baseRefName: "main"
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchPR("test/repo", 10);

    expect(result.state).toBe("CLOSED");
    expect(result.head.ref).toBe("old-branch");
    expect(result.base.ref).toBe("main");
  });

  it("should use custom gh path", async () => {
    const mockResponse = {
      number: 1,
      title: "Test PR",
      body: "",
      state: "OPEN",
      headRefName: "feat/test",
      headRefOid: "abcdef01",
      baseRefName: "main"
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchPR("test/repo", 1, { ghPath: "/custom/gh" });

    expect(mockRunCli).toHaveBeenCalledWith(
      "/custom/gh",
      ["pr", "view", "1", "--repo", "test/repo", "--json", "number,title,body,state,headRefName,headRefOid,baseRefName"],
      { timeout: undefined }
    );
  });

  it("should pass timeout option to runCli", async () => {
    const mockResponse = {
      number: 5,
      title: "Timeout test PR",
      body: "",
      state: "OPEN",
      headRefName: "branch",
      headRefOid: "sha1sha2sha3",
      baseRefName: "main"
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    await fetchPR("test/repo", 5, { timeout: 8000 });

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "5", "--repo", "test/repo", "--json", "number,title,body,state,headRefName,headRefOid,baseRefName"],
      { timeout: 8000 }
    );
  });

  it("should throw error when PR not found (404)", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "no pull requests found for branch 'nonexistent'. HTTP 404: not found",
      exitCode: 1
    });

    await expect(fetchPR("test/repo", 9999)).rejects.toThrow(
      "Failed to fetch PR #9999 from test/repo: GitHub pr view failed: Resource not found"
    );
  });

  it("should throw error when stdout contains not found", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "GraphQL: Could not resolve to a PullRequest. not found",
      stderr: "",
      exitCode: 1
    });

    await expect(fetchPR("test/repo", 99)).rejects.toThrow(
      "Failed to fetch PR #99 from test/repo: GitHub pr view failed: Resource not found"
    );
  });

  it("should throw auth error when 401 authentication required", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "HTTP 401: authentication required",
      exitCode: 1
    });

    await expect(fetchPR("test/repo", 1)).rejects.toThrow(
      "Failed to fetch PR #1 from test/repo: GitHub pr view failed: Authentication required"
    );
  });

  it("should throw permission error when 403 forbidden", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "HTTP 403: Forbidden - insufficient permissions to access private repo",
      exitCode: 1
    });

    await expect(fetchPR("private/repo", 7)).rejects.toThrow(
      "Failed to fetch PR #7 from private/repo: GitHub pr view failed: Permission denied"
    );
  });

  it("should throw rate limit error when rate limit exceeded", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "API rate limit exceeded for user",
      exitCode: 1
    });

    await expect(fetchPR("test/repo", 3)).rejects.toThrow(
      "Failed to fetch PR #3 from test/repo: GitHub pr view failed: Rate limit exceeded"
    );
  });

  it("should throw error when JSON is malformed", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "not valid json at all",
      stderr: "",
      exitCode: 0
    });

    await expect(fetchPR("test/repo", 1)).rejects.toThrow(
      "Failed to parse gh output for PR #1: not valid json at all"
    );
  });

  it("should throw error when JSON is partially malformed", async () => {
    mockRunCli.mockResolvedValue({
      stdout: '{"number": 1, "title": "Test", "broken":',
      stderr: "",
      exitCode: 0
    });

    await expect(fetchPR("test/repo", 1)).rejects.toThrow(
      'Failed to parse gh output for PR #1: {"number": 1, "title": "Test", "broken":'
    );
  });

  it("should throw error on network timeout", async () => {
    mockRunCli.mockRejectedValue(new Error("ETIMEDOUT: operation timed out"));

    await expect(fetchPR("test/repo", 2, { timeout: 500 })).rejects.toThrow(
      "ETIMEDOUT: operation timed out"
    );
  });

  it("should throw not found error when accessing PR on deleted repository", async () => {
    mockRunCli.mockResolvedValue({
      stdout: "",
      stderr: "Could not resolve to a Repository with the name 'deleted/repo'. HTTP 404: not found",
      exitCode: 1
    });

    await expect(fetchPR("deleted/repo", 1)).rejects.toThrow(
      "Failed to fetch PR #1 from deleted/repo: GitHub pr view failed: Resource not found"
    );
  });

  it("should map headRefName and headRefOid to head.ref and head.sha", async () => {
    const mockResponse = {
      number: 77,
      title: "Field mapping test",
      body: "Verify field mapping",
      state: "MERGED",
      headRefName: "feature/branch-name",
      headRefOid: "commitsha123456",
      baseRefName: "develop"
    };

    mockRunCli.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: "",
      exitCode: 0
    });

    const result = await fetchPR("test/repo", 77);

    expect(result.head.ref).toBe("feature/branch-name");
    expect(result.head.sha).toBe("commitsha123456");
    expect(result.base.ref).toBe("develop");
  });

});