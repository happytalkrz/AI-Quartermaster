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

import { fetchIssue } from "../../src/github/issue-fetcher.js";
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

});