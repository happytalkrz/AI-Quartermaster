import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ProjectSource } from "../../../src/config/sources/project-source.js";

describe("ProjectSource", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-project-source-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should have name 'project'", () => {
    const source = new ProjectSource(testDir);
    expect(source.name).toBe("project");
  });

  it("should throw if config.yml is not found", () => {
    const source = new ProjectSource(testDir);
    expect(() => source.load()).toThrow("config.yml not found");
  });

  it("should load and parse config.yml", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "project-test"
git:
  allowedRepos:
    - "owner/repo"
`);
    const source = new ProjectSource(testDir);
    const result = source.load();
    expect(result).toHaveProperty("general.projectName", "project-test");
    expect((result as { git: { allowedRepos: string[] } }).git.allowedRepos).toContain("owner/repo");
  });

  it("should merge config.local.yml on top of config.yml", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "project-test"
  logLevel: "info"
git:
  allowedRepos:
    - "owner/repo"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  logLevel: "debug"
`);
    const source = new ProjectSource(testDir);
    const result = source.load();
    expect(result).toHaveProperty("general.projectName", "project-test");
    expect(result).toHaveProperty("general.logLevel", "debug");
  });

  it("should not throw if config.local.yml is absent", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "project-test"
git:
  allowedRepos:
    - "owner/repo"
`);
    const source = new ProjectSource(testDir);
    expect(() => source.load()).not.toThrow();
  });

  it("should throw on YAML syntax error in config.yml", () => {
    writeFileSync(join(testDir, "config.yml"), "key:\n\tbad_indent: value");
    const source = new ProjectSource(testDir);
    expect(() => source.load()).toThrow();
  });

  it("should throw on YAML syntax error in config.local.yml", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "project-test"
`);
    writeFileSync(join(testDir, "config.local.yml"), "key:\n\tbad_indent: value");
    const source = new ProjectSource(testDir);
    expect(() => source.load()).toThrow();
  });

  it("should return empty object for non-object config.yml content", () => {
    // null YAML gets normalized to {}
    writeFileSync(join(testDir, "config.yml"), "null");
    const source = new ProjectSource(testDir);
    const result = source.load();
    expect(result).toEqual({});
  });
});
