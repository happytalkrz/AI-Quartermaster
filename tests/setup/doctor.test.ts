import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runDoctor } from "../../src/setup/doctor.js";
import { AQConfig } from "../../types/config.js";
import { TryLoadConfigResult } from "../../src/config/loader.js";
import * as cliRunner from "../../src/utils/cli-runner.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("runDoctor", () => {
  let testDir: string;
  let consoleLogs: string[];

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-doctor-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Mock console.log to capture output
    consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => {
      consoleLogs.push(message);
    });

    // Mock CLI runner with default success responses
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (command === "git" && args.includes("--version")) {
        return { exitCode: 0, stdout: "git version 2.34.1", stderr: "" };
      }
      if (command === "gh" && args.includes("--version")) {
        return { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" };
      }
      if (command === "claude" && args.includes("--version")) {
        return { exitCode: 0, stdout: "Claude Code 1.2.3", stderr: "" };
      }
      if (command === "gh" && args.includes("auth") && args.includes("status")) {
        return { exitCode: 0, stdout: "Logged in to github.com as testuser", stderr: "" };
      }
      if (command === "git" && args.includes("config") && args.includes("credential.helper")) {
        return { exitCode: 0, stdout: "gh", stderr: "" };
      }
      if (command === "find" && args.includes(".git/objects")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args.includes("rev-parse") && args.includes("--git-dir")) {
        return { exitCode: 0, stdout: ".git", stderr: "" };
      }
      if (command === "git" && args.includes("remote") && args.includes("get-url")) {
        return { exitCode: 0, stdout: "git@github.com:test/repo.git", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function createMockConfig(projectPath?: string): AQConfig {
    return {
      general: {
        projectName: "test-project",
        logLevel: "info",
        logDir: "logs",
        dryRun: false,
        locale: "ko",
        concurrency: 1,
        stuckTimeoutMs: 300000,
        pollingIntervalMs: 5000,
        maxJobs: 10,
      },
      git: {
        defaultBaseBranch: "main",
        branchTemplate: "aq/{{issueNumber}}-{{slug}}",
        commitMessageTemplate: "[#{{issueNumber}}] {{issueTitle}}",
        remoteAlias: "origin",
        allowedRepos: [],
        gitPath: "git",
        fetchDepth: 1,
        signCommits: false,
      },
      worktree: {
        rootPath: "/tmp/aq-worktrees",
        cleanupOnSuccess: true,
        cleanupOnFailure: false,
        maxAge: "7d",
        dirTemplate: "{{issueNumber}}-{{slug}}",
      },
      commands: {
        claudeCli: {
          path: "claude",
          model: "claude-opus-4-5",
          models: {
            plan: "claude-opus-4-5",
            phase: "claude-sonnet-4-5",
            review: "claude-haiku-4-5",
            fallback: "claude-sonnet-4-5",
          },
          maxTurns: 50,
          timeout: 300000,
          additionalArgs: [],
        },
        ghCli: { path: "gh", timeout: 30000 },
        test: "npm test",
        lint: "npm run lint",
        build: "npm run build",
        typecheck: "npx tsc --noEmit",
        preInstall: "npm ci",
        claudeMdPath: "./CLAUDE.md",
      },
      review: {
        enabled: true,
        rounds: [],
        simplify: { enabled: true, promptTemplate: "" },
      },
      pr: {
        targetBranch: "main",
        draft: true,
        titleTemplate: "[#{{issueNumber}}] {{issueTitle}}",
        bodyTemplate: "Fixes #{{issueNumber}}",
        labels: ["auto-generated"],
        assignees: [],
        reviewers: [],
        linkIssue: true,
        autoMerge: false,
        mergeMethod: "squash",
      },
      safety: {
        sensitivePaths: [".env", "credentials"],
        maxPhases: 10,
        maxRetries: 3,
        maxTotalDurationMs: 3600000,
        maxFileChanges: 50,
        maxInsertions: 1000,
        maxDeletions: 500,
        requireTests: false,
        blockDirectBasePush: true,
        timeouts: {
          planGeneration: 300000,
          phaseImplementation: 600000,
          reviewRound: 180000,
          prCreation: 120000,
        },
        stopConditions: ["CRITICAL", "SECURITY"],
        allowedLabels: ["bug", "feature", "docs"],
        rollbackStrategy: "failed-only",
      },
      projects: projectPath ? [{ repo: "test/repo", path: projectPath }] : [],
    };
  }

  it("should check only prerequisites when config is null", async () => {
    await runDoctor(null, testDir);

    const output = consoleLogs.join("\n");

    // Should check prerequisites
    expect(output).toContain("[사전 요구사항]");
    expect(output).toContain("PASS");
    expect(output).toContain("git CLI");
    expect(output).toContain("gh CLI");
    expect(output).toContain("claude CLI");

    // Should check GitHub auth
    expect(output).toContain("[GitHub 인증]");

    // Should show warning about config file
    expect(output).toContain("[설정 파일]");
    expect(output).toContain("WARN");
    expect(output).toContain("설정 파일을 로드하지 않고 실행 중입니다");

    // Should warn about skipping project checks
    expect(output).toContain("[프로젝트]");
    expect(output).toContain("설정 파일이 없어 프로젝트별 점검을 건너뜁니다");

    // Should check port and disk
    expect(output).toContain("[포트 가용성]");
    expect(output).toContain("[디스크 쓰기 권한]");
  });

  it("should show YAML syntax error message when configError has yaml_syntax type", async () => {
    const configError: TryLoadConfigResult['error'] = {
      type: 'yaml_syntax',
      message: 'Failed to parse config.yml: invalid YAML syntax at line 3'
    };

    await runDoctor(null, testDir, configError);

    const output = consoleLogs.join("\n");

    expect(output).toContain("[설정 파일]");
    expect(output).toContain("FAIL");
    expect(output).toContain("YAML 문법");
    expect(output).toContain("Failed to parse config.yml: invalid YAML syntax at line 3");
  });

  it("should show validation error message when configError has validation type", async () => {
    const configError: TryLoadConfigResult['error'] = {
      type: 'validation',
      message: 'Invalid configuration',
      details: [
        'projects[0].repo is required',
        'projects[0].path must be non-empty'
      ]
    };

    await runDoctor(null, testDir, configError);

    const output = consoleLogs.join("\n");

    expect(output).toContain("[설정 파일]");
    expect(output).toContain("FAIL");
    expect(output).toContain("설정 검증");
    expect(output).toContain("Invalid configuration");
    expect(output).toContain("ERROR");
    expect(output).toContain("projects[0].repo is required");
    expect(output).toContain("projects[0].path must be non-empty");
  });

  it("should show not_found error message when configError has not_found type", async () => {
    const configError: TryLoadConfigResult['error'] = {
      type: 'not_found',
      message: 'config.yml not found at /test/path/config.yml'
    };

    await runDoctor(null, testDir, configError);

    const output = consoleLogs.join("\n");

    expect(output).toContain("[설정 파일]");
    expect(output).toContain("FAIL");
    expect(output).toContain("config.yml");
    expect(output).toContain("config.yml not found at /test/path/config.yml");
  });

  it("should show FAIL message when project path does not exist", async () => {
    const mockConfig = createMockConfig("/nonexistent/path");

    await runDoctor(mockConfig, testDir);

    const output = consoleLogs.join("\n");

    expect(output).toContain("[프로젝트: test/repo]");
    expect(output).toContain("FAIL");
    expect(output).toContain("경로 존재 여부");
    expect(output).toContain("경로가 없습니다: /nonexistent/path");
  });

  it("should perform full checks when config is valid and projects exist", async () => {
    // Create a fake git repository for testing
    const projectPath = join(testDir, "test-project");
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(join(projectPath, ".git"), { recursive: true });

    // Create a package.json with required scripts
    writeFileSync(join(projectPath, "package.json"), JSON.stringify({
      scripts: {
        test: "vitest run",
        lint: "eslint src/",
        build: "npm run build"
      }
    }));

    const mockConfig = createMockConfig(projectPath);

    await runDoctor(mockConfig, testDir);

    const output = consoleLogs.join("\n");

    // Should perform all checks
    expect(output).toContain("[사전 요구사항]");
    expect(output).toContain("[GitHub 인증]");
    expect(output).toContain("[설정 파일]");
    expect(output).toContain("config.yml 로드 성공");
    expect(output).toContain("[프로젝트: test/repo]");
    expect(output).toContain("경로 & git 저장소");
    expect(output).toContain("git safe.directory");
    expect(output).toContain("git 권한");
    expect(output).toContain("remote URL");
    expect(output).toContain("package.json script");
    expect(output).toContain("[포트 가용성]");
    expect(output).toContain("[디스크 쓰기 권한]");
    expect(output).toContain("=== Doctor 완료 ===");
  });

  it("should show claude version warning when version is below minimum", async () => {
    // Mock claude CLI to return old version
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (command === "claude" && args.includes("--version")) {
        return { exitCode: 0, stdout: "Claude Code 0.9.0", stderr: "" };
      }
      if (command === "git" && args.includes("--version")) {
        return { exitCode: 0, stdout: "git version 2.34.1", stderr: "" };
      }
      if (command === "gh" && args.includes("--version")) {
        return { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" };
      }
      if (command === "gh" && args.includes("auth") && args.includes("status")) {
        return { exitCode: 0, stdout: "Logged in to github.com as testuser", stderr: "" };
      }
      if (command === "git" && args.includes("config") && args.includes("credential.helper")) {
        return { exitCode: 0, stdout: "gh", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await runDoctor(null, testDir);

    const output = consoleLogs.join("\n");

    expect(output).toContain("WARN");
    expect(output).toContain("claude CLI (v0.9.0)");
    expect(output).toContain("최소 권장 버전은 v1.0.0입니다");
    expect(output).toContain("claude update");
  });

  it("should show FAIL when CLI tools are not available", async () => {
    // Mock CLI failures
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (args.includes("--version")) {
        return { exitCode: 1, stdout: "", stderr: "command not found" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await runDoctor(null, testDir);

    const output = consoleLogs.join("\n");

    expect(output).toContain("FAIL");
    expect(output).toContain("git CLI");
    expect(output).toContain("gh CLI");
    expect(output).toContain("claude CLI");
    expect(output).toContain("PATH에 설치되어 있는지 확인하세요");
  });
});