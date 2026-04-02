import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadConfig,
  tryLoadConfig,
  detectGitInfo,
  writeMinimalConfig,
  addProjectToConfig,
  initProject
} from "../../src/config/loader.js";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as cliRunner from "../../src/utils/cli-runner.js";

describe("loadConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load and validate a valid config", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    const config = loadConfig(testDir);
    expect(config.general.projectName).toBe("test-project");
    expect(config.git.defaultBaseBranch).toBe("main");
  });

  it("should throw if config.yml is missing", () => {
    expect(() => loadConfig(testDir)).toThrow("config.yml not found");
  });

  it("should throw if projectName is empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""
git:
  allowedRepos:
    - "test/repo"
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should throw if allowedRepos is empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test"
git:
  allowedRepos: []
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should merge config.local.yml overrides", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  logLevel: "info"
git:
  allowedRepos:
    - "test/repo"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  logLevel: "debug"
`);
    const config = loadConfig(testDir);
    expect(config.general.logLevel).toBe("debug");
    expect(config.general.projectName).toBe("test-project");
  });

  it("should use default values for missing fields", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    const config = loadConfig(testDir);
    expect(config.git.branchTemplate).toBe("aq/{{issueNumber}}-{{slug}}");
    expect(config.worktree.cleanupOnSuccess).toBe(true);
    expect(config.safety.maxPhases).toBe(10);
    expect(config.commands.claudeCli.model).toBe("claude-opus-4-5");
  });

  it("should provide friendly error message for YAML tab characters in config.yml", () => {
    // 탭 문자가 포함된 YAML (문자열에서 \t는 실제 탭 문자로 변환됨)
    const yamlWithTab = `general:
\tprojectName: "test-project"
git:
  allowedRepos:
    - "test/repo"`;
    writeFileSync(join(testDir, "config.yml"), yamlWithTab);

    expect(() => loadConfig(testDir)).toThrow(/YAML 설정 파일에 탭 문자가 포함되어 있습니다/);
  });

  it("should provide friendly error message for YAML tab characters in config.local.yml", () => {
    // 유효한 config.yml 먼저 생성
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);

    // 탭 문자가 포함된 config.local.yml
    const yamlWithTab = `general:
\tlogLevel: "debug"`;
    writeFileSync(join(testDir, "config.local.yml"), yamlWithTab);

    expect(() => loadConfig(testDir)).toThrow(/YAML 설정 파일에 탭 문자가 포함되어 있습니다/);
  });

  it("should load minimal config with only projects array", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "owner/repo-name"
    path: "/path/to/local/clone"
`);
    const config = loadConfig(testDir);

    // Check that projects are loaded
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("owner/repo-name");
    expect(config.projects?.[0].path).toBe("/path/to/local/clone");

    // Check that defaults are merged correctly
    expect(config.general.projectName).toBe("ai-quartermaster");
    expect(config.general.logLevel).toBe("info");
    expect(config.git.defaultBaseBranch).toBe("main");
    expect(config.git.allowedRepos).toEqual([]);
    expect(config.worktree.cleanupOnSuccess).toBe(true);
    expect(config.commands.claudeCli.model).toBe("claude-opus-4-5");
  });

  it("should merge projects config with defaults and local overrides", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "test/repo"
    path: "/test/path"
    baseBranch: "develop"
general:
  logLevel: "debug"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  concurrency: 3
worktree:
  cleanupOnFailure: true
`);

    const config = loadConfig(testDir);

    // Check projects
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("test/repo");
    expect(config.projects?.[0].path).toBe("/test/path");
    expect(config.projects?.[0].baseBranch).toBe("develop");

    // Check merged values
    expect(config.general.logLevel).toBe("debug"); // from config.yml
    expect(config.general.concurrency).toBe(3); // from config.local.yml
    expect(config.general.projectName).toBe("ai-quartermaster"); // from defaults
    expect(config.worktree.cleanupOnFailure).toBe(true); // from config.local.yml
    expect(config.worktree.cleanupOnSuccess).toBe(true); // from defaults
  });

  it("should support mixed projects and allowedRepos configuration", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "mixed-project"
git:
  allowedRepos:
    - "legacy/repo"
projects:
  - repo: "new/repo"
    path: "/new/path"
`);

    const config = loadConfig(testDir);

    // Both should be present
    expect(config.git.allowedRepos).toEqual(["legacy/repo"]);
    expect(config.projects).toHaveLength(1);
    expect(config.projects?.[0].repo).toBe("new/repo");
    expect(config.projects?.[0].path).toBe("/new/path");
    expect(config.general.projectName).toBe("mixed-project");
  });

  it("should throw if both allowedRepos and projects are empty", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos: []
`);
    expect(() => loadConfig(testDir)).toThrow(/허용된 리포지토리가 설정되지 않았습니다/);
  });

  it("should validate projects array structure", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: ""
    path: "/valid/path"
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  it("should validate that projects have required fields", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "valid/repo"
    # missing path field
`);
    expect(() => loadConfig(testDir)).toThrow();
  });

  describe("user-friendly validation error messages", () => {
    it("should provide friendly error message for empty projectName", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""
git:
  allowedRepos:
    - "test/repo"
`);
      expect(() => loadConfig(testDir)).toThrow(/프로젝트 이름을 입력해주세요/);
    });

    it("should provide friendly error message for missing projects and allowedRepos", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos: []
`);
      expect(() => loadConfig(testDir)).toThrow(/허용된 리포지토리가 설정되지 않았습니다/);
    });

    it("should provide friendly error message for invalid concurrency type", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  concurrency: "invalid"
git:
  allowedRepos:
    - "test/repo"
`);
      expect(() => loadConfig(testDir)).toThrow(/동시 실행 수는 양의 정수여야 합니다/);
    });

    it("should provide friendly error message for maxPhases too small", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
safety:
  maxPhases: 0
`);
      expect(() => loadConfig(testDir)).toThrow(/최대 페이즈 수는 1 이상이어야 합니다/);
    });

    it("should provide friendly error message for maxPhases too big", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
safety:
  maxPhases: 50
`);
      expect(() => loadConfig(testDir)).toThrow(/최대 페이즈 수는 20 이하여야 합니다/);
    });

    it("should provide friendly error message for stuckTimeoutMs too small", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  stuckTimeoutMs: 30000
git:
  allowedRepos:
    - "test/repo"
`);
      expect(() => loadConfig(testDir)).toThrow(/작업 중단 타임아웃은 최소 60초\(60000ms\) 이상이어야 합니다/);
    });

    it("should provide friendly error message for pollingIntervalMs too small", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  pollingIntervalMs: 5000
git:
  allowedRepos:
    - "test/repo"
`);
      expect(() => loadConfig(testDir)).toThrow(/폴링 주기는 최소 10초\(10000ms\) 이상이어야 합니다/);
    });

    it("should provide friendly error message for invalid branchTemplate", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
  branchTemplate: "feature/no-issue-number"
`);
      expect(() => loadConfig(testDir)).toThrow(/브랜치 템플릿에 이슈 번호 플레이스홀더가 없습니다/);
    });

    it("should provide friendly error message with example for invalid worktree.rootPath type", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
worktree:
  rootPath: 123
`);
      const error = () => loadConfig(testDir);
      expect(error).toThrow(/워크트리 루트 경로는 문자열이어야 합니다/);
      expect(error).toThrow(/rootPath: "\.aq-worktrees"/);
    });

    it("should include solution and example in error message", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""
git:
  allowedRepos:
    - "test/repo"
`);
      try {
        loadConfig(testDir);
        expect.fail("Expected error to be thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toMatch(/해결방법:/);
        expect(message).toMatch(/예시:/);
        expect(message).toMatch(/projectName: "my-awesome-project"/);
      }
    });

    it("should handle multiple validation errors", () => {
      writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""
git:
  allowedRepos: []
safety:
  maxPhases: 0
`);
      try {
        loadConfig(testDir);
        expect.fail("Expected error to be thrown");
      } catch (error) {
        const message = (error as Error).message;
        // 여러 에러가 모두 포함되어야 함
        expect(message).toMatch(/프로젝트 이름을 입력해주세요/);
        expect(message).toMatch(/허용된 리포지토리가 설정되지 않았습니다/);
        expect(message).toMatch(/최대 페이즈 수는 1 이상이어야 합니다/);
      }
    });
  });
});

describe("tryLoadConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should return config when config.yml exists and is valid", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(result.config?.general.projectName).toBe("test-project");
  });

  it("should return not_found error when config.yml is missing", () => {
    const result = tryLoadConfig(testDir);

    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("not_found");
    expect(result.error?.message).toContain("config.yml not found");
  });

  it("should return yaml_syntax error when config.yml has invalid YAML", () => {
    writeFileSync(join(testDir, "config.yml"), `
invalid yaml:
  - unclosed bracket: [
    missing quote: "test
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("yaml_syntax");
    expect(result.error?.message).toContain("Failed to parse config.yml");
  });

  it("should return yaml_syntax error when config.local.yml has invalid YAML", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
invalid yaml:
  - unclosed bracket: [
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("yaml_syntax");
    expect(result.error?.message).toContain("Failed to parse config.local.yml");
  });

  it("should return validation error when config is invalid", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: ""  # empty project name should fail validation
git:
  allowedRepos:
    - "test/repo"
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error?.type).toBe("validation");
    expect(result.error?.message).toContain("설정 파일에 오류가 있습니다");
    expect(result.error?.details).toBeTruthy();
  });

  it("should successfully merge config.local.yml overrides", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
  logLevel: "info"
git:
  allowedRepos:
    - "test/repo"
`);
    writeFileSync(join(testDir, "config.local.yml"), `
general:
  logLevel: "debug"
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(result.config?.general.logLevel).toBe("debug");
    expect(result.config?.general.projectName).toBe("test-project");
  });

  it("should ignore missing config.local.yml without error", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
`);
    // No config.local.yml file created

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(result.config?.general.projectName).toBe("test-project");
  });

  it("should work with minimal projects-only config", () => {
    writeFileSync(join(testDir, "config.yml"), `
projects:
  - repo: "owner/repo-name"
    path: "/path/to/local/clone"
`);

    const result = tryLoadConfig(testDir);

    expect(result.config).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(result.config?.projects).toHaveLength(1);
    expect(result.config?.projects?.[0].repo).toBe("owner/repo-name");
  });
});
