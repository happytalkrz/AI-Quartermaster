import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { updateProjectInConfig } from "../../src/config/loader.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("updateProjectInConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should update existing project fields", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
general:
  projectName: "test-project"

projects:
  - repo: "target/repo"
    path: "/old/path"
    baseBranch: "old-branch"
    mode: "plan"
  - repo: "other/repo"
    path: "/other/path"

safety:
  maxPhases: 10
`);

    updateProjectInConfig(configPath, "target/repo", {
      path: "/new/path",
      baseBranch: "main",
      mode: "content"
    });

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain('path: "/new/path"');
    expect(content).toContain('baseBranch: "main"');
    expect(content).toContain('mode: "content"');
    expect(content).toContain("other/repo"); // Other projects preserved
    expect(content).toContain("maxPhases: 10"); // Other sections preserved
  });

  it("should add missing fields to existing project", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "target/repo"
    path: "/existing/path"
`);

    updateProjectInConfig(configPath, "target/repo", {
      baseBranch: "develop",
      mode: "content"
    });

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain('path: "/existing/path"');
    expect(content).toContain('baseBranch: "develop"');
    expect(content).toContain('mode: "content"');
  });

  it("should update only specified fields", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "target/repo"
    path: "/old/path"
    baseBranch: "old-branch"
    mode: "plan"
`);

    updateProjectInConfig(configPath, "target/repo", {
      path: "/new/path"
    });

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain('path: "/new/path"');
    expect(content).toContain('baseBranch: "old-branch"'); // Unchanged
    expect(content).toContain('mode: "plan"'); // Unchanged
  });

  it("should preserve YAML formatting and comments", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `# Main config
general:
  projectName: "test-project"

# Projects section
projects:
  # Target project
  - repo: "target/repo"
    path: "/old/path"
    baseBranch: "old"
  # Other project
  - repo: "keep/repo"
    path: "/keep/path"

# Safety config
safety:
  maxPhases: 5
`);

    updateProjectInConfig(configPath, "target/repo", {
      path: "/updated/path",
      mode: "content"
    });

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("# Main config");
    expect(content).toContain("# Projects section");
    expect(content).toContain("# Target project");
    expect(content).toContain("# Other project");
    expect(content).toContain("# Safety config");
    expect(content).toContain('path: "/updated/path"');
    expect(content).toContain('mode: "content"');
    expect(content).toContain("keep/repo");
  });

  it("should throw error when projects section doesn't exist", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
general:
  projectName: "test-project"

safety:
  maxPhases: 10
`);

    expect(() => {
      updateProjectInConfig(configPath, "target/repo", { path: "/new/path" });
    }).toThrow("No projects section found in config");
  });

  it("should throw error when target project doesn't exist", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "existing/repo"
    path: "/existing/path"
`);

    expect(() => {
      updateProjectInConfig(configPath, "nonexistent/repo", { path: "/new/path" });
    }).toThrow('Project "nonexistent/repo" not found in config');
  });
});