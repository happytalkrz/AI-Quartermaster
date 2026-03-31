import { describe, it, expect } from "vitest";
import { resolveProject, listConfiguredRepos } from "../../src/config/project-resolver.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

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
