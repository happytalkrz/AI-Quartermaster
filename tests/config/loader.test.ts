import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadConfig,
  tryLoadConfig,
  detectGitInfo,
  writeMinimalConfig,
  addProjectToConfig,
  removeProjectFromConfig,
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

describe("detectGitInfo", () => {
  let mockCwd: string;

  beforeEach(() => {
    mockCwd = "/test/repo";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should detect GitHub SSH remote URL and default branch", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:owner/repo.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "not found" };
    });

    const result = await detectGitInfo(mockCwd);

    expect(result.repo).toBe("owner/repo");
    expect(result.baseBranch).toBe("main");
    expect(result.error).toBeUndefined();
  });

  it("should detect GitHub HTTPS remote URL", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/develop\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "not found" };
    });

    const result = await detectGitInfo(mockCwd);

    expect(result.repo).toBe("owner/repo");
    expect(result.baseBranch).toBe("develop");
  });

  it("should detect GitHub URL without .git suffix", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "https://github.com/owner/repo\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        throw new Error("no such ref"); // symbolic-ref throws exception
      }
      if (command === "git" && args.includes("config") && args.includes("init.defaultBranch")) {
        return { exitCode: 0, stdout: "main\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "not found" };
    });

    const result = await detectGitInfo(mockCwd);

    expect(result.repo).toBe("owner/repo");
    expect(result.baseBranch).toBe("main");
  });

  it("should fallback to 'main' when no branch detection works", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:owner/repo.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        throw new Error("no such ref"); // symbolic-ref throws exception
      }
      if (command === "git" && args.includes("config")) {
        throw new Error("no config found"); // config also throws exception
      }
      return { exitCode: 1, stdout: "", stderr: "not found" };
    });

    const result = await detectGitInfo(mockCwd);

    expect(result.repo).toBe("owner/repo");
    expect(result.baseBranch).toBe("main");
  });

  it("should return undefined repo when remote detection fails", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 1, stdout: "", stderr: "no remote configured" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "not found" };
    });

    const result = await detectGitInfo(mockCwd);

    expect(result.repo).toBeUndefined();
    expect(result.baseBranch).toBe("main");
  });

  it("should handle git command failures gracefully", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      // All git commands fail but function should still return some result
      throw new Error("Git command failed");
    });

    const result = await detectGitInfo(mockCwd);

    // When all git commands fail, we should get undefined repo and fallback branch
    expect(result.repo).toBeUndefined();
    expect(result.baseBranch).toBe("main"); // Fallback to main
    expect(result.error).toBeUndefined(); // Should not error, just return undefined values
  });
});

describe("writeMinimalConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create minimal config.yml with basic project info", () => {
    const configPath = join(testDir, "config.yml");
    const project = {
      repo: "owner/repo",
      path: "/test/path"
    };

    writeMinimalConfig(configPath, project);

    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("# AI Quartermaster 설정 파일");
    expect(content).toContain('repo: "owner/repo"');
    expect(content).toContain('path: "/test/path"');
    expect(content).toContain("projects:");
  });

  it("should include optional baseBranch and mode when provided", () => {
    const configPath = join(testDir, "config.yml");
    const project = {
      repo: "owner/repo",
      path: "/test/path",
      baseBranch: "develop",
      mode: "content" as const
    };

    writeMinimalConfig(configPath, project);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain('baseBranch: "develop"');
    expect(content).toContain('mode: "content"');
  });

  it("should not include baseBranch and mode when not provided", () => {
    const configPath = join(testDir, "config.yml");
    const project = {
      repo: "owner/repo",
      path: "/test/path"
    };

    writeMinimalConfig(configPath, project);

    const content = readFileSync(configPath, "utf-8");

    expect(content).not.toContain("baseBranch:");
    expect(content).not.toContain("mode:");
  });

  it("should include usage comments and documentation links", () => {
    const configPath = join(testDir, "config.yml");
    const project = {
      repo: "owner/repo",
      path: "/test/path"
    };

    writeMinimalConfig(configPath, project);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("# 추가 설정이 필요한 경우");
    expect(content).toContain("# general:");
    expect(content).toContain("# safety:");
  });
});

describe("addProjectToConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should add project to existing projects section", () => {
    const configPath = join(testDir, "config.yml");
    const existingContent = `# Test config
general:
  projectName: "test-project"

projects:
  - repo: "existing/repo"
    path: "/existing/path"
    baseBranch: "main"

safety:
  maxPhases: 10
`;
    writeFileSync(configPath, existingContent);

    const newProject = {
      repo: "new/repo",
      path: "/new/path",
      baseBranch: "develop",
      mode: "content" as const
    };

    addProjectToConfig(configPath, newProject);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("existing/repo");
    expect(content).toContain("new/repo");
    expect(content).toContain('path: "/new/path"');
    expect(content).toContain('baseBranch: "develop"');
    expect(content).toContain('mode: "content"');
  });

  it("should create projects section when not exists", () => {
    const configPath = join(testDir, "config.yml");
    const existingContent = `# Test config
general:
  projectName: "test-project"

safety:
  maxPhases: 10
`;
    writeFileSync(configPath, existingContent);

    const newProject = {
      repo: "new/repo",
      path: "/new/path"
    };

    addProjectToConfig(configPath, newProject);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("projects:");
    expect(content).toContain("new/repo");
    expect(content).toContain("/new/path");
    expect(content).toContain("safety:"); // Existing content preserved
  });

  it("should preserve existing file format and indentation", () => {
    const configPath = join(testDir, "config.yml");
    const existingContent = `general:
  projectName: "test-project"
  logLevel: "info"

projects:
  - repo: "existing/repo"
    path: "/existing/path"

# Comment preserved
safety:
  maxPhases: 10
`;
    writeFileSync(configPath, existingContent);

    const newProject = {
      repo: "new/repo",
      path: "/new/path"
    };

    addProjectToConfig(configPath, newProject);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("# Comment preserved");
    expect(content).toContain("logLevel: \"info\"");
    expect(content).toContain("maxPhases: 10");

    // Check indentation is preserved
    const lines = content.split('\n');
    const projectsLine = lines.find(line => line.includes("projects:"));
    expect(projectsLine).toMatch(/^projects:\s*$/); // No leading spaces for projects:

    const newRepoLine = lines.find(line => line.includes("new/repo"));
    expect(newRepoLine).toMatch(/^ {2}- repo:/); // 2 spaces for project items
  });

  it("should handle empty projects section", () => {
    const configPath = join(testDir, "config.yml");
    const existingContent = `general:
  projectName: "test-project"

projects:

safety:
  maxPhases: 10
`;
    writeFileSync(configPath, existingContent);

    const newProject = {
      repo: "first/repo",
      path: "/first/path"
    };

    addProjectToConfig(configPath, newProject);

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("first/repo");
    expect(content).toContain("/first/path");
  });
});

describe("removeProjectFromConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should remove project from existing config", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
# AQ Config
general:
  projectName: "test-project"

projects:
  - repo: "existing/repo"
    path: "/existing/path"
    baseBranch: "main"
  - repo: "target/repo"
    path: "/target/path"
    baseBranch: "develop"
    mode: "content"
  - repo: "another/repo"
    path: "/another/path"

safety:
  maxPhases: 5
`);

    removeProjectFromConfig(configPath, "target/repo");

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("existing/repo");
    expect(content).toContain("another/repo");
    expect(content).not.toContain("target/repo");
    expect(content).not.toContain("/target/path");
    expect(content).not.toContain("develop");
    expect(content).toContain("# AQ Config");
    expect(content).toContain("maxPhases: 5");
  });

  it("should do nothing when projects section doesn't exist", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
general:
  projectName: "test-project"

safety:
  maxPhases: 5
`);

    removeProjectFromConfig(configPath, "target/repo");

    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("test-project");
    expect(content).toContain("maxPhases: 5");
  });

  it("should do nothing when target project doesn't exist", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "existing/repo"
    path: "/existing/path"
`);

    removeProjectFromConfig(configPath, "nonexistent/repo");

    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("existing/repo");
    expect(content).toContain("/existing/path");
  });

  it("should preserve YAML formatting and comments", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `# Main config
general:
  projectName: "test-project"

# Projects section
projects:
  # First project
  - repo: "keep/repo"
    path: "/keep/path"
  # Target project to remove
  - repo: "remove/repo"
    path: "/remove/path"
    baseBranch: "develop"
  # Last project
  - repo: "last/repo"
    path: "/last/path"

# Safety config
safety:
  maxPhases: 10
`);

    removeProjectFromConfig(configPath, "remove/repo");

    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("# Main config");
    expect(content).toContain("# Projects section");
    expect(content).toContain("# First project");
    expect(content).toContain("# Last project");
    expect(content).toContain("# Safety config");
    expect(content).not.toContain("remove/repo");
    expect(content).not.toContain("/remove/path");
  });

  it("should handle project with minimal fields", () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "simple/repo"
    path: "/simple/path"
  - repo: "complex/repo"
    path: "/complex/path"
    baseBranch: "feature"
    mode: "content"
`);

    removeProjectFromConfig(configPath, "simple/repo");

    const content = readFileSync(configPath, "utf-8");
    expect(content).not.toContain("simple/repo");
    expect(content).toContain("complex/repo");
    expect(content).toContain("feature");
    expect(content).toContain("content");
  });
});

describe("initProject", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Mock process.cwd
    vi.spyOn(process, "cwd").mockReturnValue("/test/current/dir");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should create new config.yml when not exists", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:test/repo.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    });

    await initProject(testDir, {});

    const configPath = join(testDir, "config.yml");
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("test/repo");
    expect(content).toContain("/test/current/dir");
  });

  it("should add to existing config.yml", async () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
general:
  projectName: "existing-project"

projects:
  - repo: "existing/repo"
    path: "/existing/path"
`);

    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:new/repo.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/develop\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    });

    await initProject(testDir, {});

    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("existing/repo");
    expect(content).toContain("new/repo");
    expect(content).toContain("develop");
  });

  it("should use provided options over detected values", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:auto/detected.git\n", stderr: "" };
      }
      if (command === "git" && args.includes("symbolic-ref")) {
        return { exitCode: 0, stdout: "refs/remotes/origin/auto-branch\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    });

    await initProject(testDir, {
      repo: "override/repo",
      path: "/override/path",
      baseBranch: "feature",
      mode: "content"
    });

    const configPath = join(testDir, "config.yml");
    const content = readFileSync(configPath, "utf-8");

    expect(content).toContain("override/repo");
    expect(content).toContain("/override/path");
    expect(content).toContain("feature");
    expect(content).toContain("content");
    expect(content).not.toContain("auto/detected");
  });

  it("should throw error when git detection returns no repo", async () => {
    // When git commands fail, detectGitInfo returns undefined repo
    vi.spyOn(cliRunner, "runCli").mockImplementation(async () => {
      throw new Error("Git not found");
    });

    await expect(initProject(testDir, {})).rejects.toThrow("GitHub 저장소를 감지할 수 없습니다");
  });

  it("should throw error when no repo detected and not provided", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      // Git commands succeed but return no repo info
      return { exitCode: 1, stdout: "", stderr: "no remote" };
    });

    await expect(initProject(testDir, {})).rejects.toThrow("GitHub 저장소를 감지할 수 없습니다");
  });

  it("should throw error when project already exists without force", async () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "existing/repo"
    path: "/existing/path"
`);

    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:existing/repo.git\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
    });

    await expect(initProject(testDir, {})).rejects.toThrow("이미 등록되어 있습니다");
  });

  it("should overwrite when project exists with force option", async () => {
    const configPath = join(testDir, "config.yml");
    writeFileSync(configPath, `
projects:
  - repo: "existing/repo"
    path: "/old/path"
`);

    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command, args) => {
      if (command === "git" && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:existing/repo.git\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await initProject(testDir, { force: true });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("덮어씁니다"));

    // Should still add the project (implementation may vary)
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("existing/repo");
  });
});
