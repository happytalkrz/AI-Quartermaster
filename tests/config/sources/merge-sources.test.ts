import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mergeSources } from "../../../src/config/sources/index.js";
import { ManagedSource } from "../../../src/config/sources/managed-source.js";
import { UserSource } from "../../../src/config/sources/user-source.js";
import { ProjectSource } from "../../../src/config/sources/project-source.js";
import { CliSource } from "../../../src/config/sources/cli-source.js";
import { EnvSource } from "../../../src/config/sources/env-source.js";

describe("mergeSources — 5단계 병합 통합 테스트", () => {
  let testDir: string;
  let userDir: string;

  beforeEach(() => {
    const ts = Date.now();
    testDir = join(tmpdir(), `aq-merge-test-${ts}`);
    userDir = join(tmpdir(), `aq-merge-user-${ts}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  function writeProjectConfig(content: string): void {
    writeFileSync(join(testDir, "config.yml"), content);
  }

  it("should merge Managed source only and return validated config", async () => {
    writeProjectConfig(`
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "owner/repo"
`);
    const result = await mergeSources({
      managed: new ManagedSource(),
      project: new ProjectSource(testDir),
    });

    expect(result.config.general.projectName).toBe("test-project");
    // defaults from managed
    expect(result.config.general.logLevel).toBe("info");
    expect(result.sources).toContain("managed");
    expect(result.sources).toContain("project");
  });

  it("should apply User source on top of Managed", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
git:
  allowedRepos:
    - "owner/repo"
`);
    const userConfigPath = join(userDir, "config.yml");
    writeFileSync(userConfigPath, `
general:
  logLevel: "warn"
  concurrency: 4
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      user: new UserSource(userConfigPath),
      project: new ProjectSource(testDir),
    });

    expect(result.config.general.logLevel).toBe("warn");
    expect(result.config.general.concurrency).toBe(4);
    expect(result.sources).toEqual(expect.arrayContaining(["managed", "user", "project"]));
  });

  it("should apply CLI overrides above Project", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
  logLevel: "info"
git:
  allowedRepos:
    - "owner/repo"
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      project: new ProjectSource(testDir),
      cli: new CliSource({ general: { logLevel: "debug" } }),
    });

    expect(result.config.general.logLevel).toBe("debug");
    expect(result.sources).toContain("cli");
  });

  it("should apply Env overrides at highest priority", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
  logLevel: "info"
git:
  allowedRepos:
    - "owner/repo"
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      project: new ProjectSource(testDir),
      cli: new CliSource({ general: { logLevel: "debug" } }),
      env: new EnvSource({ AQM_GENERAL_LOG_LEVEL: "warn" }),
    });

    // env beats cli
    expect(result.config.general.logLevel).toBe("warn");
    expect(result.sources).toContain("env");
  });

  it("should apply all 5 sources in priority order: Managed→User→Project→CLI→Env", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
  logLevel: "info"
git:
  allowedRepos:
    - "owner/repo"
`);
    const userConfigPath = join(userDir, "config.yml");
    writeFileSync(userConfigPath, `
general:
  logLevel: "debug"
  concurrency: 2
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      user: new UserSource(userConfigPath),
      project: new ProjectSource(testDir),
      cli: new CliSource({ general: { concurrency: 3 } }),
      env: new EnvSource({ AQM_GENERAL_LOG_LEVEL: "error" }),
    });

    // env wins for logLevel
    expect(result.config.general.logLevel).toBe("error");
    // cli wins for concurrency over user
    expect(result.config.general.concurrency).toBe(3);
    // project's value is preserved where not overridden
    expect(result.config.general.projectName).toBe("project-name");
    // all 5 sources listed
    expect(result.sources).toEqual(["managed", "user", "project", "cli", "env"]);
  });

  it("should skip sources not provided and exclude them from sources list", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
git:
  allowedRepos:
    - "owner/repo"
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      project: new ProjectSource(testDir),
      // no user, cli, env
    });

    expect(result.sources).not.toContain("user");
    expect(result.sources).not.toContain("cli");
    expect(result.sources).not.toContain("env");
  });

  it("should use Managed defaults when User source file does not exist", async () => {
    writeProjectConfig(`
general:
  projectName: "project-name"
git:
  allowedRepos:
    - "owner/repo"
`);

    const result = await mergeSources({
      managed: new ManagedSource(),
      user: new UserSource(join(userDir, "nonexistent.yml")), // file absent → {}
      project: new ProjectSource(testDir),
    });

    // managed default survives since user returned {}
    expect(result.config.general.logLevel).toBe("info");
    // user source still counted (it ran, returned {})
    expect(result.sources).toContain("user");
  });
});
