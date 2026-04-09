import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectSource } from "../../../src/config/sources/project-source.js";

describe("ProjectSource", () => {
  let tmpDir: string;
  let source: ProjectSource;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `aqm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    source = new ProjectSource();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should have name 'project'", () => {
    expect(source.name).toBe("project");
  });

  it("should throw when config.yml is not found", () => {
    expect(() => source.load({ projectRoot: tmpDir })).toThrow(
      `config.yml not found at ${tmpDir}/config.yml`
    );
  });

  it("should load config.yml successfully", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: test-project
  logLevel: debug
`);

    const result = source.load({ projectRoot: tmpDir });

    expect(result).toEqual({
      general: {
        projectName: "test-project",
        logLevel: "debug",
      },
    });
  });

  it("should merge config.local.yml on top of config.yml", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: base-project
  logLevel: info
git:
  defaultBaseBranch: main
`);
    writeFileSync(join(tmpDir, "config.local.yml"), `
general:
  logLevel: debug
`);

    const result = source.load({ projectRoot: tmpDir });

    expect(result).toMatchObject({
      general: {
        projectName: "base-project",
        logLevel: "debug",
      },
      git: {
        defaultBaseBranch: "main",
      },
    });
  });

  it("should not require config.local.yml", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: no-local
`);

    expect(() => source.load({ projectRoot: tmpDir })).not.toThrow();
    const result = source.load({ projectRoot: tmpDir });
    expect(result).toMatchObject({ general: { projectName: "no-local" } });
  });

  it("should throw on YAML syntax error in config.yml", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: [unclosed
`);

    expect(() => source.load({ projectRoot: tmpDir })).toThrow();
  });

  it("should throw on YAML syntax error in config.local.yml", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: base
`);
    writeFileSync(join(tmpDir, "config.local.yml"), `
general:
  logLevel: [unclosed
`);

    expect(() => source.load({ projectRoot: tmpDir })).toThrow();
  });

  it("should handle empty config.yml as empty object", () => {
    writeFileSync(join(tmpDir, "config.yml"), "");

    const result = source.load({ projectRoot: tmpDir });

    expect(result).toEqual({});
  });

  it("should return null when config.yml parses to a non-object", () => {
    writeFileSync(join(tmpDir, "config.yml"), `- item1\n- item2`);

    const result = source.load({ projectRoot: tmpDir });

    expect(result).toEqual({});
  });

  it("should deep merge nested config.local.yml fields", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: base
  logLevel: info
safety:
  allowedLabels:
    - enhancement
    - bug
`);
    writeFileSync(join(tmpDir, "config.local.yml"), `
safety:
  allowedLabels:
    - local-only
`);

    const result = source.load({ projectRoot: tmpDir });

    expect(result).toMatchObject({
      general: { projectName: "base", logLevel: "info" },
      safety: { allowedLabels: ["local-only"] },
    });
  });

  it("should ignore context.envVars and context.configOverrides (not project source's concern)", () => {
    writeFileSync(join(tmpDir, "config.yml"), `
general:
  projectName: base
`);

    const result = source.load({
      projectRoot: tmpDir,
      envVars: { AQM_GENERAL_PROJECT_NAME: "from-env" },
      configOverrides: { general: { projectName: "from-cli" } },
    });

    expect(result).toMatchObject({ general: { projectName: "base" } });
  });
});
