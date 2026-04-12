import { describe, it, expect } from "vitest";
import { resolveProject } from "../../src/config/project-resolver.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";

const createTestConfig = (
  repo: string,
  path: string,
  overrides: Partial<AQConfig["projects"][0]>
): AQConfig => ({
  ...structuredClone(DEFAULT_CONFIG),
  general: { ...DEFAULT_CONFIG.general, projectName: "test" },
  git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
  projects: [{ repo, path, ...overrides }],
});

describe("Project Override Integration Tests", () => {
  describe("commands override", () => {
    it("should override specific commands while preserving others", () => {
      const config = createTestConfig("myorg/custom-commands", "/home/user/custom-commands", {
        commands: {
          test: "yarn vitest",
          build: "npm run build:prod",
          claudeCli: {
            model: "claude-haiku-4-5-20251001",
            maxTurns: 100,
          },
        },
      });

      const resolved = resolveProject("myorg/custom-commands", config);

      // Overridden commands
      expect(resolved.commands.test).toBe("yarn vitest");
      expect(resolved.commands.build).toBe("npm run build:prod");
      expect(resolved.commands.claudeCli.model).toBe("claude-haiku-4-5-20251001");
      expect(resolved.commands.claudeCli.maxTurns).toBe(100);

      // Inherited commands (not overridden)
      expect(resolved.commands.lint).toBe(DEFAULT_CONFIG.commands.lint);
      expect(resolved.commands.typecheck).toBe(DEFAULT_CONFIG.commands.typecheck);
      expect(resolved.commands.claudeCli.path).toBe(DEFAULT_CONFIG.commands.claudeCli.path);
      expect(resolved.commands.claudeCli.timeout).toBe(DEFAULT_CONFIG.commands.claudeCli.timeout);
    });

    it("should merge nested claudeCli config with deep merge", () => {
      const config = createTestConfig("myorg/claude-override", "/home/user/claude-override", {
        commands: {
          claudeCli: {
            models: {
              plan: "claude-sonnet-4-20250514",
              // phase and review inherit from default
            },
            additionalArgs: ["--custom-flag"],
            // other claudeCli properties inherit from default
          },
        },
      });

      const resolved = resolveProject("myorg/claude-override", config);

      // Overridden nested properties
      expect(resolved.commands.claudeCli.models.plan).toBe("claude-sonnet-4-20250514");
      expect(resolved.commands.claudeCli.additionalArgs).toEqual(["--custom-flag"]);

      // Inherited nested properties
      expect(resolved.commands.claudeCli.models.phase).toBe(DEFAULT_CONFIG.commands.claudeCli.models.phase);
      expect(resolved.commands.claudeCli.models.review).toBe(DEFAULT_CONFIG.commands.claudeCli.models.review);
      expect(resolved.commands.claudeCli.path).toBe(DEFAULT_CONFIG.commands.claudeCli.path);
      expect(resolved.commands.claudeCli.model).toBe(DEFAULT_CONFIG.commands.claudeCli.model);
      expect(resolved.commands.claudeCli.maxTurns).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurns);
    });
  });

  describe("safety override", () => {
    it("should override specific safety settings while preserving others", () => {
      const config = createTestConfig("myorg/high-security", "/home/user/high-security", {
        safety: {
          maxPhases: 5,
          maxRetries: 1,
          maxFileChanges: 10,
          sensitivePaths: [".env.prod", "secrets/**", "*.key"],
          allowedLabels: ["bug", "security"],
        },
      });

      const resolved = resolveProject("myorg/high-security", config);

      // Overridden safety settings
      expect(resolved.safety.maxPhases).toBe(5);
      expect(resolved.safety.maxRetries).toBe(1);
      expect(resolved.safety.maxFileChanges).toBe(10);
      expect(resolved.safety.sensitivePaths).toEqual([".env.prod", "secrets/**", "*.key"]);
      expect(resolved.safety.allowedLabels).toEqual(["bug", "security"]);

      // Inherited safety settings (not overridden)
      expect(resolved.safety.maxTotalDurationMs).toBe(DEFAULT_CONFIG.safety.maxTotalDurationMs);
      expect(resolved.safety.maxInsertions).toBe(DEFAULT_CONFIG.safety.maxInsertions);
      expect(resolved.safety.maxDeletions).toBe(DEFAULT_CONFIG.safety.maxDeletions);
      expect(resolved.safety.requireTests).toBe(DEFAULT_CONFIG.safety.requireTests);
      expect(resolved.safety.blockDirectBasePush).toBe(DEFAULT_CONFIG.safety.blockDirectBasePush);
      expect(resolved.safety.rollbackStrategy).toBe(DEFAULT_CONFIG.safety.rollbackStrategy);
    });

    it("should merge nested timeouts config with deep merge", () => {
      const config = createTestConfig("myorg/custom-timeouts", "/home/user/custom-timeouts", {
        safety: {
          timeouts: {
            planGeneration: 300000,
            phaseImplementation: 900000,
            // reviewRound and prCreation inherit from default
          },
          feasibilityCheck: {
            maxRequirements: 8,
            // other feasibilityCheck properties inherit from default
          },
        },
      });

      const resolved = resolveProject("myorg/custom-timeouts", config);

      // Overridden nested properties
      expect(resolved.safety.timeouts.planGeneration).toBe(300000);
      expect(resolved.safety.timeouts.phaseImplementation).toBe(900000);
      expect(resolved.safety.feasibilityCheck.maxRequirements).toBe(8);

      // Inherited nested properties
      expect(resolved.safety.timeouts.reviewRound).toBe(DEFAULT_CONFIG.safety.timeouts.reviewRound);
      expect(resolved.safety.timeouts.prCreation).toBe(DEFAULT_CONFIG.safety.timeouts.prCreation);
      expect(resolved.safety.feasibilityCheck.enabled).toBe(DEFAULT_CONFIG.safety.feasibilityCheck.enabled);
      expect(resolved.safety.feasibilityCheck.maxFiles).toBe(DEFAULT_CONFIG.safety.feasibilityCheck.maxFiles);
      expect(resolved.safety.feasibilityCheck.blockedKeywords).toEqual(DEFAULT_CONFIG.safety.feasibilityCheck.blockedKeywords);
    });
  });

  describe("review override", () => {
    it("should override specific review settings while preserving others", () => {
      const config = createTestConfig("myorg/custom-review", "/home/user/custom-review", {
        review: {
          enabled: false,
          unifiedMode: true,
          rounds: [
            {
              name: "security-review",
              promptTemplate: "Focus on security vulnerabilities:\n\n{diff}",
              failAction: "block",
              maxRetries: 3,
              model: "claude-opus-4-5",
              blind: false,
              adversarial: false,
            },
            {
              name: "performance-review",
              promptTemplate: "Analyze performance implications:\n\n{diff}",
              failAction: "warn",
              maxRetries: 1,
              model: null,
              blind: true,
            },
          ],
        },
      });

      const resolved = resolveProject("myorg/custom-review", config);

      // Overridden review settings
      expect(resolved.review.enabled).toBe(false);
      expect(resolved.review.unifiedMode).toBe(true);
      expect(resolved.review.rounds).toHaveLength(2);

      // First custom round
      expect(resolved.review.rounds[0].name).toBe("security-review");
      expect(resolved.review.rounds[0].promptTemplate).toBe("Focus on security vulnerabilities:\n\n{diff}");
      expect(resolved.review.rounds[0].failAction).toBe("block");
      expect(resolved.review.rounds[0].maxRetries).toBe(3);
      expect(resolved.review.rounds[0].model).toBe("claude-opus-4-5");
      expect(resolved.review.rounds[0].blind).toBe(false);
      expect(resolved.review.rounds[0].adversarial).toBe(false);

      // Second custom round
      expect(resolved.review.rounds[1].name).toBe("performance-review");
      expect(resolved.review.rounds[1].promptTemplate).toBe("Analyze performance implications:\n\n{diff}");
      expect(resolved.review.rounds[1].failAction).toBe("warn");
      expect(resolved.review.rounds[1].maxRetries).toBe(1);
      expect(resolved.review.rounds[1].model).toBe(null);
      expect(resolved.review.rounds[1].blind).toBe(true);
      expect(resolved.review.rounds[1].adversarial).toBeUndefined(); // optional property

      // Inherited review settings (not overridden)
      expect(resolved.review.simplify.enabled).toBe(DEFAULT_CONFIG.review.simplify.enabled);
      expect(resolved.review.simplify.promptTemplate).toBe(DEFAULT_CONFIG.review.simplify.promptTemplate);
    });

    it("should merge nested simplify config with deep merge", () => {
      const config = createTestConfig("myorg/custom-simplify", "/home/user/custom-simplify", {
        review: {
          simplify: {
            enabled: false,
            // promptTemplate inherits from default
          },
        },
      });

      const resolved = resolveProject("myorg/custom-simplify", config);

      // Overridden nested property
      expect(resolved.review.simplify.enabled).toBe(false);

      // Inherited nested property
      expect(resolved.review.simplify.promptTemplate).toBe(DEFAULT_CONFIG.review.simplify.promptTemplate);

      // Inherited top-level properties
      expect(resolved.review.enabled).toBe(DEFAULT_CONFIG.review.enabled);
      expect(resolved.review.rounds).toEqual(DEFAULT_CONFIG.review.rounds);
      expect(resolved.review.unifiedMode).toBe(DEFAULT_CONFIG.review.unifiedMode);
    });
  });

  describe("multiple overrides combined", () => {
    it("should handle project with all three override types simultaneously", () => {
      const config = createTestConfig("myorg/comprehensive-override", "/home/user/comprehensive-override", {
        commands: {
          test: "jest --coverage",
          claudeCli: { model: "claude-sonnet-4-20250514" },
        },
        safety: {
          maxPhases: 15,
          allowedLabels: ["enhancement"],
        },
        review: {
          enabled: true,
          unifiedMode: true,
        },
      });

      const resolved = resolveProject("myorg/comprehensive-override", config);

      // Commands overrides
      expect(resolved.commands.test).toBe("jest --coverage");
      expect(resolved.commands.claudeCli.model).toBe("claude-sonnet-4-20250514");
      expect(resolved.commands.lint).toBe(DEFAULT_CONFIG.commands.lint); // inherited

      // Safety overrides
      expect(resolved.safety.maxPhases).toBe(15);
      expect(resolved.safety.allowedLabels).toEqual(["enhancement"]);
      expect(resolved.safety.maxRetries).toBe(DEFAULT_CONFIG.safety.maxRetries); // inherited

      // Review overrides
      expect(resolved.review.enabled).toBe(true);
      expect(resolved.review.unifiedMode).toBe(true);
      expect(resolved.review.rounds).toEqual(DEFAULT_CONFIG.review.rounds); // inherited

      // Other top-level properties inherited
      expect(resolved.pr).toEqual(DEFAULT_CONFIG.pr);
    });
  });

  describe("edge cases", () => {
    it("should handle empty override objects", () => {
      const config = createTestConfig("myorg/empty-overrides", "/home/user/empty-overrides", {
        commands: {},
        safety: {},
        review: {},
      });

      const resolved = resolveProject("myorg/empty-overrides", config);

      // All should inherit from defaults
      expect(resolved.commands).toEqual(DEFAULT_CONFIG.commands);
      expect(resolved.safety).toEqual(DEFAULT_CONFIG.safety);
      expect(resolved.review).toEqual(DEFAULT_CONFIG.review);
    });

    it("should handle project with no overrides defined", () => {
      const config = createTestConfig("myorg/no-overrides", "/home/user/no-overrides", {});

      const resolved = resolveProject("myorg/no-overrides", config);

      // All should inherit from defaults
      expect(resolved.commands).toEqual(DEFAULT_CONFIG.commands);
      expect(resolved.safety).toEqual(DEFAULT_CONFIG.safety);
      expect(resolved.review).toEqual(DEFAULT_CONFIG.review);
    });
  });

  describe("cross-project isolation", () => {
    it("should not leak project A overrides into project B", () => {
      const baseConfig: AQConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        general: { ...DEFAULT_CONFIG.general, projectName: "test" },
        git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
        projects: [
          {
            repo: "myorg/project-a",
            path: "/home/user/project-a",
            commands: {
              test: "yarn test",
              claudeCli: { model: "claude-haiku-4-5-20251001" },
            },
          },
          {
            repo: "myorg/project-b",
            path: "/home/user/project-b",
            safety: {
              maxPhases: 3,
              allowedLabels: ["b-label"],
            },
          },
        ],
      };

      const resolvedA = resolveProject("myorg/project-a", baseConfig);
      const resolvedB = resolveProject("myorg/project-b", baseConfig);

      // A's overrides are applied to A
      expect(resolvedA.commands.test).toBe("yarn test");
      expect(resolvedA.commands.claudeCli.model).toBe("claude-haiku-4-5-20251001");

      // A's overrides do NOT appear in B
      expect(resolvedB.commands.test).toBe(DEFAULT_CONFIG.commands.test);
      expect(resolvedB.commands.claudeCli.model).toBe(DEFAULT_CONFIG.commands.claudeCli.model);

      // B's overrides are applied to B
      expect(resolvedB.safety.maxPhases).toBe(3);
      expect(resolvedB.safety.allowedLabels).toEqual(["b-label"]);

      // B's overrides do NOT appear in A
      expect(resolvedA.safety.maxPhases).toBe(DEFAULT_CONFIG.safety.maxPhases);
      expect(resolvedA.safety.allowedLabels).toEqual(DEFAULT_CONFIG.safety.allowedLabels);
    });

    it("should produce independent result objects for each project", () => {
      const baseConfig: AQConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        general: { ...DEFAULT_CONFIG.general, projectName: "test" },
        git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
        projects: [
          { repo: "myorg/proj-x", path: "/home/user/proj-x", commands: { test: "jest" } },
          { repo: "myorg/proj-y", path: "/home/user/proj-y", commands: { test: "mocha" } },
        ],
      };

      const resolvedX = resolveProject("myorg/proj-x", baseConfig);
      const resolvedY = resolveProject("myorg/proj-y", baseConfig);

      expect(resolvedX.commands.test).toBe("jest");
      expect(resolvedY.commands.test).toBe("mocha");

      // Mutating one result does not affect the other
      resolvedX.commands.test = "mutated";
      expect(resolvedY.commands.test).toBe("mocha");
    });
  });

  describe("global fallback", () => {
    const createFallbackConfig = (repo: string): AQConfig => ({
      ...structuredClone(DEFAULT_CONFIG),
      general: { ...DEFAULT_CONFIG.general, projectName: "test", targetRoot: "/home/user/fallback" },
      git: { ...DEFAULT_CONFIG.git, allowedRepos: [repo] },
      projects: [],
    });

    it("should return global config for repo in allowedRepos but not in projects", () => {
      const config = createFallbackConfig("myorg/fallback-repo");
      const resolved = resolveProject("myorg/fallback-repo", config);

      expect(resolved.commands).toEqual(DEFAULT_CONFIG.commands);
      expect(resolved.safety).toEqual(DEFAULT_CONFIG.safety);
      expect(resolved.review).toEqual(DEFAULT_CONFIG.review);
      expect(resolved.pr).toEqual(DEFAULT_CONFIG.pr);
    });

    it("should use global git config for baseBranch and branchTemplate on fallback", () => {
      const config = createFallbackConfig("myorg/fallback-repo");
      const resolved = resolveProject("myorg/fallback-repo", config);

      expect(resolved.baseBranch).toBe(DEFAULT_CONFIG.git.defaultBaseBranch);
      expect(resolved.branchTemplate).toBe(DEFAULT_CONFIG.git.branchTemplate);
    });

    it("should throw when repo is not in projects or allowedRepos", () => {
      const config: AQConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        general: { ...DEFAULT_CONFIG.general, projectName: "test" },
        git: { ...DEFAULT_CONFIG.git, allowedRepos: [] },
        projects: [],
      };

      expect(() => resolveProject("myorg/unknown-repo", config)).toThrow(
        "myorg/unknown-repo"
      );
    });

    it("should throw when fallback path is not configured", () => {
      const config: AQConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        general: { ...DEFAULT_CONFIG.general, projectName: "test", targetRoot: undefined },
        git: { ...DEFAULT_CONFIG.git, allowedRepos: ["myorg/no-path-repo"] },
        projects: [],
      };

      expect(() => resolveProject("myorg/no-path-repo", config)).toThrow(
        "myorg/no-path-repo"
      );
    });
  });

  describe("PR override", () => {
    it("should override specific pr settings while preserving others", () => {
      const config = createTestConfig("myorg/pr-override", "/home/user/pr-override", {
        pr: {
          draft: false,
          labels: ["feature", "auto-pr"],
          mergeMethod: "merge",
        },
      });

      const resolved = resolveProject("myorg/pr-override", config);

      // Overridden fields
      expect(resolved.pr.draft).toBe(false);
      expect(resolved.pr.labels).toEqual(["feature", "auto-pr"]);
      expect(resolved.pr.mergeMethod).toBe("merge");

      // Inherited fields
      expect(resolved.pr.targetBranch).toBe(DEFAULT_CONFIG.pr.targetBranch);
      expect(resolved.pr.titleTemplate).toBe(DEFAULT_CONFIG.pr.titleTemplate);
      expect(resolved.pr.bodyTemplate).toBe(DEFAULT_CONFIG.pr.bodyTemplate);
      expect(resolved.pr.assignees).toEqual(DEFAULT_CONFIG.pr.assignees);
      expect(resolved.pr.reviewers).toEqual(DEFAULT_CONFIG.pr.reviewers);
      expect(resolved.pr.linkIssue).toBe(DEFAULT_CONFIG.pr.linkIssue);
      expect(resolved.pr.autoMerge).toBe(DEFAULT_CONFIG.pr.autoMerge);
    });

    it("should merge pr override with all fields specified", () => {
      const config = createTestConfig("myorg/full-pr-override", "/home/user/full-pr-override", {
        pr: {
          targetBranch: "develop",
          draft: true,
          titleTemplate: "[CUSTOM] {{title}}",
          bodyTemplate: "## Custom Body\n\n{summary}",
          labels: ["custom"],
          assignees: ["dev1"],
          reviewers: ["reviewer1"],
          linkIssue: false,
          autoMerge: true,
          mergeMethod: "rebase",
        },
      });

      const resolved = resolveProject("myorg/full-pr-override", config);

      expect(resolved.pr.targetBranch).toBe("develop");
      expect(resolved.pr.draft).toBe(true);
      expect(resolved.pr.titleTemplate).toBe("[CUSTOM] {{title}}");
      expect(resolved.pr.bodyTemplate).toBe("## Custom Body\n\n{summary}");
      expect(resolved.pr.labels).toEqual(["custom"]);
      expect(resolved.pr.assignees).toEqual(["dev1"]);
      expect(resolved.pr.reviewers).toEqual(["reviewer1"]);
      expect(resolved.pr.linkIssue).toBe(false);
      expect(resolved.pr.autoMerge).toBe(true);
      expect(resolved.pr.mergeMethod).toBe("rebase");
    });
  });

  describe("deepMerge edge cases", () => {
    it("should replace array fields (not concat) when overridden", () => {
      const config = createTestConfig("myorg/array-replace", "/home/user/array-replace", {
        commands: {
          claudeCli: {
            additionalArgs: ["--new-flag"],
          },
        },
        safety: {
          sensitivePaths: [".env.local"],
        },
      });

      const resolved = resolveProject("myorg/array-replace", config);

      // Arrays are replaced, not concatenated
      expect(resolved.commands.claudeCli.additionalArgs).toEqual(["--new-flag"]);
      expect(resolved.commands.claudeCli.additionalArgs).not.toContain(
        ...(DEFAULT_CONFIG.commands.claudeCli.additionalArgs.length > 0
          ? [DEFAULT_CONFIG.commands.claudeCli.additionalArgs[0]]
          : ["__never__"])
      );

      expect(resolved.safety.sensitivePaths).toEqual([".env.local"]);
      expect(resolved.safety.sensitivePaths).not.toEqual(
        expect.arrayContaining(DEFAULT_CONFIG.safety.sensitivePaths)
      );
    });

    it("should replace empty array override (not keep defaults)", () => {
      const config = createTestConfig("myorg/empty-array", "/home/user/empty-array", {
        safety: {
          allowedLabels: [],
          sensitivePaths: [],
        },
      });

      const resolved = resolveProject("myorg/empty-array", config);

      expect(resolved.safety.allowedLabels).toEqual([]);
      expect(resolved.safety.sensitivePaths).toEqual([]);
    });

    it("should handle project with undefined optional fields gracefully", () => {
      const config = createTestConfig("myorg/undefined-fields", "/home/user/undefined-fields", {
        commands: {
          claudeCli: {
            retry: undefined,
          },
        },
      });

      // Should not throw
      expect(() => resolveProject("myorg/undefined-fields", config)).not.toThrow();

      const resolved = resolveProject("myorg/undefined-fields", config);
      // Other commands fields are still inherited
      expect(resolved.commands.claudeCli.path).toBe(DEFAULT_CONFIG.commands.claudeCli.path);
      expect(resolved.commands.claudeCli.maxTurns).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurns);
    });
  });

  describe("DEFAULT_CONFIG immutability", () => {
    it("should not mutate DEFAULT_CONFIG after resolveProject with overrides", () => {
      const snapshot = structuredClone(DEFAULT_CONFIG);

      const config = createTestConfig("myorg/mutation-check", "/home/user/mutation-check", {
        commands: {
          test: "yarn test",
          claudeCli: {
            model: "claude-haiku-4-5-20251001",
            additionalArgs: ["--injected"],
          },
        },
        safety: {
          maxPhases: 99,
          sensitivePaths: ["injected/**"],
        },
        review: {
          enabled: false,
          rounds: [],
        },
        pr: {
          draft: false,
          labels: ["mutated"],
        },
      });

      resolveProject("myorg/mutation-check", config);

      expect(DEFAULT_CONFIG).toEqual(snapshot);
    });

    it("should not mutate DEFAULT_CONFIG after multiple resolveProject calls", () => {
      const snapshot = structuredClone(DEFAULT_CONFIG);

      for (let i = 0; i < 3; i++) {
        const config = createTestConfig(`myorg/multi-call-${i}`, `/home/user/multi-call-${i}`, {
          commands: { test: `run-${i}` },
          safety: { maxPhases: i + 1 },
        });
        resolveProject(`myorg/multi-call-${i}`, config);
      }

      expect(DEFAULT_CONFIG).toEqual(snapshot);
    });
  });
});