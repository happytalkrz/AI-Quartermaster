import { describe, it, expect } from "vitest";
import { resolveProject, listConfiguredRepos, expandProjectPath, AQM_HOME } from "../../src/config/project-resolver.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { homedir } from "os";

describe("resolveProject", () => {
  it("should resolve project from projects array", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
      projects: [{
        repo: "myorg/my-app",
        path: "/home/user/my-app",
        baseBranch: "develop",
        commands: { test: "yarn test" },
      }],
    };
    const resolved = resolveProject("myorg/my-app", config);
    expect(resolved.path).toBe("/home/user/my-app");
    expect(resolved.baseBranch).toBe("develop");
    expect(resolved.commands.test).toBe("yarn test");
    expect(resolved.commands.lint).toBe(DEFAULT_CONFIG.commands.lint); // inherits default
  });

  it("should fall back to global config for allowedRepos", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test", targetRoot: "/fallback" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: ["org/fallback-repo"] },
    };
    const resolved = resolveProject("org/fallback-repo", config);
    expect(resolved.path).toBe("/fallback");
    expect(resolved.baseBranch).toBe(DEFAULT_CONFIG.git.defaultBaseBranch);
  });

  it("should throw for unknown repo", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
    };
    expect(() => resolveProject("unknown/repo", config)).toThrow("not configured");
  });

  it("should override pr.targetBranch for project-specific config", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
      projects: [{
        repo: "myorg/feature-app",
        path: "/home/user/feature-app",
        pr: {
          targetBranch: "develop",
        },
      }],
    };
    const resolved = resolveProject("myorg/feature-app", config);

    // Project-specific pr.targetBranch should override global setting
    expect(resolved.pr.targetBranch).toBe("develop");

    // Other pr settings should inherit from global config
    expect(resolved.pr.draft).toBe(DEFAULT_CONFIG.pr.draft);
    expect(resolved.pr.titleTemplate).toBe(DEFAULT_CONFIG.pr.titleTemplate);
  });

  it("should use global pr.targetBranch when no project override exists", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
      projects: [{
        repo: "myorg/standard-app",
        path: "/home/user/standard-app",
        // No pr override - should use global config
      }],
    };
    const resolved = resolveProject("myorg/standard-app", config);

    // Should use global pr.targetBranch
    expect(resolved.pr.targetBranch).toBe(DEFAULT_CONFIG.pr.targetBranch); // "main"
    expect(resolved.pr.draft).toBe(DEFAULT_CONFIG.pr.draft);
  });

  it("should expand ~ path in project config", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
      projects: [{
        repo: "myorg/home-app",
        path: "~/projects/my-app",
      }],
    };
    const resolved = resolveProject("myorg/home-app", config);
    expect(resolved.path).toBe(`${homedir()}/projects/my-app`);
  });

  it("should expand relative path in project config", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
      projects: [{
        repo: "myorg/relative-app",
        path: "projects/my-app",
      }],
    };
    const resolved = resolveProject("myorg/relative-app", config);
    expect(resolved.path).toBe(`${AQM_HOME}/projects/my-app`);
  });

  it("should expand ~ path in fallback targetRoot", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test", targetRoot: "~/fallback-projects" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: ["org/fallback-repo"] },
    };
    const resolved = resolveProject("org/fallback-repo", config);
    expect(resolved.path).toBe(`${homedir()}/fallback-projects`);
  });

  it("should expand relative path in fallback targetRoot", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test", targetRoot: "projects" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: ["org/fallback-repo"] },
    };
    const resolved = resolveProject("org/fallback-repo", config);
    expect(resolved.path).toBe(`${AQM_HOME}/projects`);
  });
});

describe("listConfiguredRepos", () => {
  it("should list repos from both projects and allowedRepos", () => {
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: ["org/old-repo"] },
      projects: [{ repo: "org/new-repo", path: "/tmp" }],
    };
    const repos = listConfiguredRepos(config);
    expect(repos).toContain("org/new-repo");
    expect(repos).toContain("org/old-repo");
  });
});

describe("expandProjectPath", () => {
  it("should expand ~ to home directory", () => {
    const result = expandProjectPath("~/my-project");
    expect(result).toBe(`${homedir()}/my-project`);
  });

  it("should expand bare ~ to home directory", () => {
    const result = expandProjectPath("~");
    expect(result).toBe(homedir());
  });

  it("should resolve relative path against AQM_HOME", () => {
    const result = expandProjectPath("my-project");
    expect(result).toBe(`${AQM_HOME}/my-project`);
  });

  it("should resolve relative path with subdirectories", () => {
    const result = expandProjectPath("projects/my-app");
    expect(result).toBe(`${AQM_HOME}/projects/my-app`);
  });

  it("should return absolute path as-is", () => {
    const absolutePath = "/home/user/absolute-project";
    const result = expandProjectPath(absolutePath);
    expect(result).toBe(absolutePath);
  });
});
