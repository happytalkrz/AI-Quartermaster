import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
