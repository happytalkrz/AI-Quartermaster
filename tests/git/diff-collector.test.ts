import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { collectDiff, getDiffContent } from "../../src/git/diff-collector.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

const gitConfig = {
  defaultBaseBranch: "master",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "",
  remoteAlias: "origin",
  allowedRepos: [],
  gitPath: "git",
  fetchDepth: 0,
  signCommits: false,
};

describe("collectDiff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should parse diff stats correctly", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "src/a.ts\nsrc/b.ts\nsrc/c.ts\n", stderr: "", exitCode: 0 }) // name-only
      .mockResolvedValueOnce({ stdout: "20\t5\tsrc/a.ts\n25\t3\tsrc/b.ts\n5\t2\tsrc/c.ts\n", stderr: "", exitCode: 0 }); // numstat

    const stats = await collectDiff(gitConfig, "master", { cwd: "/tmp" });
    expect(stats.filesChanged).toBe(3);
    expect(stats.insertions).toBe(50);
    expect(stats.deletions).toBe(10);
    expect(stats.changedFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("should handle empty diff", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const stats = await collectDiff(gitConfig, "master", { cwd: "/tmp" });
    expect(stats.filesChanged).toBe(0);
    expect(stats.insertions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  it("should handle binary files in numstat", async () => {
    mockRunCli
      .mockResolvedValueOnce({ stdout: "image.png\n", stderr: "", exitCode: 0 }) // name-only
      .mockResolvedValueOnce({ stdout: "-\t-\timage.png\n", stderr: "", exitCode: 0 }); // numstat

    const stats = await collectDiff(gitConfig, "master", { cwd: "/tmp" });
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBe(0); // binary shows -
  });
});

describe("getDiffContent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return full diff", async () => {
    mockRunCli.mockResolvedValue({ stdout: "diff --git a/file.ts b/file.ts\n+new line\n", stderr: "", exitCode: 0 });
    const content = await getDiffContent(gitConfig, "master", { cwd: "/tmp" });
    expect(content).toContain("diff --git");
  });
});
