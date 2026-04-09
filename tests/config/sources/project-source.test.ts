import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadProjectSource } from "../../../src/config/sources/project-source.js";

describe("project-source", () => {
  const testDir = join(__dirname, "temp-project-source");
  const baseConfigPath = join(testDir, "config.yml");
  const localConfigPath = join(testDir, "config.local.yml");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should return not_found error when base config does not exist", () => {
    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe("not_found");
    expect(result.error?.message).toContain("config.yml not found");
  });

  it("should load base config successfully", () => {
    writeFileSync(baseConfigPath, `
general:
  projectName: "test-project"
  logLevel: "info"
`);

    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeUndefined();
    expect(result.baseConfig).toBeDefined();
    expect(result.localConfig).toBeUndefined();
  });

  it("should load both base and local config", () => {
    writeFileSync(baseConfigPath, `
general:
  projectName: "test-project"
  logLevel: "info"
`);

    writeFileSync(localConfigPath, `
general:
  logLevel: "debug"
safety:
  maxPhases: 5
`);

    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeUndefined();
    expect(result.baseConfig).toBeDefined();
    expect(result.localConfig).toBeDefined();
  });

  it("should return yaml_syntax error for invalid YAML in base config", () => {
    writeFileSync(baseConfigPath, `
general:
  projectName: "test-project"
  invalid: [unclosed
`);

    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe("yaml_syntax");
    expect(result.error?.message).toContain("Failed to parse config.yml");
  });

  it("should return yaml_syntax error for invalid YAML in local config", () => {
    writeFileSync(baseConfigPath, `
general:
  projectName: "test-project"
`);

    writeFileSync(localConfigPath, `
general:
  logLevel: "debug"
  invalid: [unclosed
`);

    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe("yaml_syntax");
    expect(result.error?.message).toContain("Failed to parse config.local.yml");
  });

  it("should handle tab character error in YAML", () => {
    // Write YAML with tab character (simulated)
    writeFileSync(baseConfigPath, `general:\n\t\tprojectName: "test"`);

    const result = loadProjectSource({ projectRoot: testDir });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe("yaml_syntax");
    expect(result.error?.message).toContain("탭 문자가 포함되어 있습니다");
  });
});