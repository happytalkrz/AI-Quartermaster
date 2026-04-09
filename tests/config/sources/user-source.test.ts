import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { UserSource } from "../../../src/config/sources/user-source.js";

describe("UserSource", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-user-source-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should have name 'user'", () => {
    const source = new UserSource(join(testDir, "nonexistent.yml"));
    expect(source.name).toBe("user");
  });

  it("should return empty object if config file does not exist", () => {
    const source = new UserSource(join(testDir, "nonexistent.yml"));
    expect(source.load()).toEqual({});
  });

  it("should load and parse valid YAML config", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
general:
  logLevel: "debug"
  concurrency: 2
`);
    const source = new UserSource(configPath);
    const result = source.load();
    expect(result).toHaveProperty("general.logLevel", "debug");
    expect(result).toHaveProperty("general.concurrency", 2);
  });

  it("should return empty object for empty YAML file", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, "");
    const source = new UserSource(configPath);
    expect(source.load()).toEqual({});
  });

  it("should return empty object for null YAML content", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, "null");
    const source = new UserSource(configPath);
    expect(source.load()).toEqual({});
  });

  it("should return empty object for non-object YAML (array)", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, "- item1\n- item2\n");
    const source = new UserSource(configPath);
    // Should log a warning and return {}
    expect(source.load()).toEqual({});
  });

  it("should return empty object on YAML parse error (logs warning)", () => {
    const configPath = join(testDir, "config.yml");
    // Write invalid YAML with tab indentation
    writeFileSync(configPath, "key:\n\tbad_indent: value");
    const source = new UserSource(configPath);
    // Should catch the error, log warning, return {}
    expect(source.load()).toEqual({});
  });

  it("should load nested config sections", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
git:
  defaultBaseBranch: "develop"
  allowedRepos:
    - "owner/repo"
safety:
  maxPhases: 5
`);
    const source = new UserSource(configPath);
    const result = source.load();
    expect(result).toHaveProperty("git.defaultBaseBranch", "develop");
    expect((result as Record<string, unknown> & { git: { allowedRepos: string[] } }).git.allowedRepos).toContain("owner/repo");
    expect(result).toHaveProperty("safety.maxPhases", 5);
  });

  it("should use ~/.aqm/config.yml as default path when no path specified", () => {
    // Just verify it constructs without throwing
    const source = new UserSource();
    expect(source.name).toBe("user");
  });
});
