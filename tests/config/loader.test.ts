import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("loadConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load and validate a valid config", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    const config = loadConfig(testDir);
    expect(config.general.projectName).toBe("test-project");
    expect(config.git.defaultBaseBranch).toBe("main");
  });

  it("should throw if config.yml is missing", () => {
    expect(() => loadConfig(testDir)).toThrow("config.yml not found");
  });

  it("should throw if projectName is empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""
git:
  allowedRepos:
    - "test/repo"
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should throw if allowedRepos is empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test"
git:
  allowedRepos: []
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should merge config.local.yml overrides", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  logLevel: "info"
git:
  allowedRepos:
    - "test/repo"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  logLevel: "debug"
`);
    const config = loadConfig(testDir);
    expect(config.general.logLevel).toBe("debug");
    expect(config.general.projectName).toBe("test-project");
  });

  it("should use default values for missing fields", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    const config = loadConfig(testDir);
    expect(config.git.branchTemplate).toBe("aq/{{issueNumber}}-{{slug}}");
    expect(config.worktree.cleanupOnSuccess).toBe(true);
    expect(config.safety.maxPhases).toBe(10);
    expect(config.commands.claudeCli.model).toBe("claude-opus-4-5");
  });

  it("should load minimal config with only projects array", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "owner/repo-name"
    path: "/path/to/local/clone"
`);
    const config = loadConfig(testDir);

    // Check that projects are loaded
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("owner/repo-name");
    expect(config.projects?.[0].path).toBe("/path/to/local/clone");

    // Check that defaults are merged correctly
    expect(config.general.projectName).toBe("ai-quartermaster");
    expect(config.general.logLevel).toBe("info");
    expect(config.git.defaultBaseBranch).toBe("main");
    expect(config.git.allowedRepos).toEqual([]);
    expect(config.worktree.cleanupOnSuccess).toBe(true);
    expect(config.commands.claudeCli.model).toBe("claude-opus-4-5");
  });

  it("should merge projects config with defaults and local overrides", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "test/repo"
    path: "/test/path"
    baseBranch: "develop"
general:
  logLevel: "debug"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  concurrency: 3
worktree:
  cleanupOnFailure: true
`);

    const config = loadConfig(testDir);

    // Check projects
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("test/repo");
    expect(config.projects?.[0].path).toBe("/test/path");
    expect(config.projects?.[0].baseBranch).toBe("develop");

    // Check merged values
    expect(config.general.logLevel).toBe("debug"); // from config.yml
    expect(config.general.concurrency).toBe(3); // from config.local.yml
    expect(config.general.projectName).toBe("ai-quartermaster"); // from defaults
    expect(config.worktree.cleanupOnFailure).toBe(true); // from config.local.yml
    expect(config.worktree.cleanupOnSuccess).toBe(true); // from defaults
  });

  it("should support mixed projects and allowedRepos configuration", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "mixed-project"
git:
  allowedRepos:
    - "legacy/repo"
projects:
  - repo: "new/repo"
    path: "/new/path"
`);

    const config = loadConfig(testDir);

    // Both should be present
    expect(config.git.allowedRepos).toEqual(["legacy/repo"]);
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("new/repo");
    expect(config.projects?.[0].path).toBe("/new/path");
    expect(config.general.projectName).toBe("mixed-project");
  });

  it("should throw if both allowedRepos and projects are empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos: []
`);
    expect(() => loadConfig(testDir)).toThrow("allowedRepos must be a non-empty array (or configure projects instead)");
  });

  it("should validate projects array structure", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: ""
    path: "/valid/path"
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should validate that projects have required fields", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "valid/repo"
    # missing path field
`);
    expect(() => loadConfig(testDir)).toThrow();
  });
});
