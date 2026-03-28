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
    expect(config.git.defaultBaseBranch).toBe("master");
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
});
