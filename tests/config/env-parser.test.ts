import { describe, it, expect } from "vitest";
import { parseEnvVars, parseEnvSection, listAQMEnvVars } from "../../src/config/env-parser.js";

describe("env-parser", () => {
  describe("parseEnvVars", () => {
    it("should parse basic environment variables", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test-project",
        AQM_GENERAL_LOG_LEVEL: "debug",
        NOT_AQM_VAR: "should-be-ignored"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          projectName: "test-project",
          logLevel: "debug"
        }
      });
    });

    it("should convert underscored keys to camelCase", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test",
        AQM_SAFETY_MAX_PHASES: "10",
        AQM_GIT_DEFAULT_BASE_BRANCH: "main",
        AQM_COMMANDS_CLAUDE_CLI_PATH: "/usr/bin/claude"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          projectName: "test"
        },
        safety: {
          maxPhases: 10
        },
        git: {
          defaultBaseBranch: "main"
        },
        commands: {
          claudeCliPath: "/usr/bin/claude"
        }
      });
    });

    it("should parse numeric values", () => {
      const env = {
        AQM_GENERAL_CONCURRENCY: "3",
        AQM_SAFETY_MAX_PHASES: "10",
        AQM_GENERAL_TIMEOUT: "30000",
        AQM_SAFETY_MAX_RETRIES: "0"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          concurrency: 3,
          timeout: 30000
        },
        safety: {
          maxPhases: 10,
          maxRetries: 0
        }
      });
    });

    it("should parse boolean values", () => {
      const env = {
        AQM_GENERAL_DRY_RUN: "true",
        AQM_SAFETY_REQUIRE_TESTS: "false",
        AQM_GIT_SIGN_COMMITS: "TRUE",
        AQM_PR_DRAFT: "False"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          dryRun: true
        },
        safety: {
          requireTests: false
        },
        git: {
          signCommits: true
        },
        pr: {
          draft: false
        }
      });
    });

    it("should parse comma-separated arrays", () => {
      const env = {
        AQM_GIT_ALLOWED_REPOS: "owner/repo1,owner/repo2,owner/repo3",
        AQM_SAFETY_ALLOWED_LABELS: "enhancement,bug,feature",
        AQM_PR_LABELS: "automated,ai-generated"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        git: {
          allowedRepos: ["owner/repo1", "owner/repo2", "owner/repo3"]
        },
        safety: {
          allowedLabels: ["enhancement", "bug", "feature"]
        },
        pr: {
          labels: ["automated", "ai-generated"]
        }
      });
    });

    it("should handle empty and whitespace in arrays", () => {
      const env = {
        AQM_GIT_ALLOWED_REPOS: "repo1, repo2 ,, repo3,",
        AQM_SAFETY_SENSITIVE_PATHS: " .env , *.key ,  "
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        git: {
          allowedRepos: ["repo1", "repo2", "repo3"]
        },
        safety: {
          sensitivePaths: [".env", "*.key"]
        }
      });
    });

    it("should handle empty string values", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "",
        AQM_GENERAL_LOG_DIR: ""
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          projectName: "",
          logDir: ""
        }
      });
    });

    it("should ignore invalid environment variable names", () => {
      const env = {
        AQM_: "should-be-ignored",
        AQM_SECTION: "should-be-ignored",
        AQM: "should-be-ignored",
        AQM_GENERAL_VALID: "should-be-included"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          valid: "should-be-included"
        }
      });
    });

    it("should handle undefined values", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test",
        AQM_GENERAL_LOG_LEVEL: undefined
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          projectName: "test"
        }
      });
    });

    it("should create nested objects correctly", () => {
      const env = {
        AQM_COMMANDS_CLAUDE_CLI_PATH: "/usr/bin/claude",
        AQM_COMMANDS_CLAUDE_CLI_MODEL: "opus",
        AQM_COMMANDS_GH_CLI_PATH: "/usr/bin/gh"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        commands: {
          claudeCliPath: "/usr/bin/claude",
          claudeCliModel: "opus",
          ghCliPath: "/usr/bin/gh"
        }
      });
    });

    it("should handle special number formats", () => {
      const env = {
        AQM_SAFETY_TIMEOUT: "1.5",
        AQM_GENERAL_RATE: "0.1",
        AQM_TEST_NEGATIVE: "-1",
        AQM_TEST_LARGE: "1000000"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        safety: {
          timeout: 1.5
        },
        general: {
          rate: 0.1
        },
        test: {
          negative: -1,
          large: 1000000
        }
      });
    });

    it("should not parse non-numeric strings as numbers", () => {
      const env = {
        AQM_GENERAL_VERSION: "1.0.0",
        AQM_GIT_BRANCH: "feature-123",
        AQM_TEST_MIXED: "123abc"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        general: {
          version: "1.0.0"
        },
        git: {
          branch: "feature-123"
        },
        test: {
          mixed: "123abc"
        }
      });
    });
  });

  describe("parseEnvSection", () => {
    it("should parse only the specified section", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test",
        AQM_GENERAL_LOG_LEVEL: "debug",
        AQM_SAFETY_MAX_PHASES: "10",
        AQM_GIT_BRANCH: "main"
      };

      const generalConfig = parseEnvSection("general", env);

      expect(generalConfig).toEqual({
        projectName: "test",
        logLevel: "debug"
      });
    });

    it("should return empty object if section not found", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test"
      };

      const missingConfig = parseEnvSection("missing", env);

      expect(missingConfig).toEqual({});
    });

    it("should handle case-insensitive section names", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test"
      };

      const generalConfig = parseEnvSection("GENERAL", env);

      expect(generalConfig).toEqual({
        projectName: "test"
      });
    });
  });

  describe("listAQMEnvVars", () => {
    it("should list all AQM_ environment variables", () => {
      const env = {
        AQM_GENERAL_PROJECT_NAME: "test",
        AQM_SAFETY_MAX_PHASES: "10",
        NOT_AQM_VAR: "ignored",
        PATH: "/usr/bin",
        AQM_GIT_BRANCH: "main"
      };

      const aqmVars = listAQMEnvVars(env);

      expect(aqmVars).toEqual([
        "AQM_GENERAL_PROJECT_NAME",
        "AQM_GIT_BRANCH",
        "AQM_SAFETY_MAX_PHASES"
      ]);
    });

    it("should return empty array if no AQM_ variables found", () => {
      const env = {
        PATH: "/usr/bin",
        USER: "test"
      };

      const aqmVars = listAQMEnvVars(env);

      expect(aqmVars).toEqual([]);
    });

    it("should sort the results", () => {
      const env = {
        AQM_Z_LAST: "last",
        AQM_A_FIRST: "first",
        AQM_M_MIDDLE: "middle"
      };

      const aqmVars = listAQMEnvVars(env);

      expect(aqmVars).toEqual([
        "AQM_A_FIRST",
        "AQM_M_MIDDLE",
        "AQM_Z_LAST"
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty environment object", () => {
      const result = parseEnvVars({});
      expect(result).toEqual({});
    });

    it("should use process.env by default", () => {
      // 실제 process.env를 사용하므로 결과는 예측하기 어렵지만,
      // 에러가 발생하지 않아야 함
      expect(() => parseEnvVars()).not.toThrow();
    });

    it("should handle very long nested keys", () => {
      const env = {
        AQM_VERY_LONG_NESTED_SECTION_WITH_MANY_PARTS: "value"
      };

      const result = parseEnvVars(env);

      expect(result).toEqual({
        very: {
          longNestedSectionWithManyParts: "value"
        }
      });
    });
  });
});