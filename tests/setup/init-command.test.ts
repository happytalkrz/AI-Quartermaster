import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runInitCommand, parseInitOptions, printInitHelp } from "../../src/setup/init-command.js";
import * as configLoader from "../../src/config/loader.js";
import * as logger from "../../src/utils/logger.js";
import { InitCommandOptions } from "../../src/types/config.js";

describe("parseInitOptions", () => {
  it("should parse basic options correctly", () => {
    const args = [
      "init",
      "--repo", "owner/repo",
      "--path", "/test/path",
      "--base-branch", "develop",
      "--mode", "content",
      "--force",
      "--dry-run"
    ];

    const options = parseInitOptions(args);

    expect(options.repo).toBe("owner/repo");
    expect(options.path).toBe("/test/path");
    expect(options.baseBranch).toBe("develop");
    expect(options.mode).toBe("content");
    expect(options.force).toBe(true);
    expect(options.dryRun).toBe(true);
  });

  it("should handle help flags", () => {
    const options1 = parseInitOptions(["init", "--help"]);
    const options2 = parseInitOptions(["init", "-h"]);

    expect(options1.help).toBe(true);
    expect(options2.help).toBe(true);
  });

  it("should validate mode options", () => {
    const validOptions = parseInitOptions(["init", "--mode", "code"]);
    const invalidOptions = parseInitOptions(["init", "--mode", "invalid"]);

    expect(validOptions.mode).toBe("code");
    expect(invalidOptions.mode).toBeUndefined();
  });

  it("should handle empty args", () => {
    const options = parseInitOptions([]);

    expect(options.repo).toBeUndefined();
    expect(options.path).toBeUndefined();
    expect(options.force).toBeUndefined();
    expect(options.dryRun).toBeUndefined();
  });

  it("should resolve absolute path", () => {
    const options = parseInitOptions(["init", "--path", "relative/path"]);

    expect(options.path).toBeDefined();
    expect(options.path?.startsWith("/")).toBe(true);
  });
});

describe("printInitHelp", () => {
  let consoleLogs: string[];

  beforeEach(() => {
    consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((message: string) => {
      consoleLogs.push(message);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should print help message", () => {
    printInitHelp();

    const output = consoleLogs.join("\n");
    expect(output).toContain("aqm init - 현재 프로젝트를 AI-Quartermaster에 등록");
    expect(output).toContain("--repo <owner/repo>");
    expect(output).toContain("--dry-run");
    expect(output).toContain("Examples:");
  });
});

describe("runInitCommand", () => {
  let consoleLogs: string[];
  let consoleErrors: string[];
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consoleLogs = [];
    consoleErrors = [];

    vi.spyOn(console, "log").mockImplementation((message: string) => {
      consoleLogs.push(message);
    });

    vi.spyOn(console, "error").mockImplementation((message: string) => {
      consoleErrors.push(message);
    });

    mockExit = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Mock process.cwd to return a predictable path
    vi.spyOn(process, "cwd").mockReturnValue("/test/current/dir");

    // Mock logger to prevent actual logging
    vi.spyOn(logger, "getLogger").mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should detect git info and register project successfully", async () => {
    // Mock successful git detection
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "owner/repo",
      baseBranch: "main"
    });

    // Mock successful project initialization
    vi.spyOn(configLoader, "initProject").mockResolvedValue();

    await runInitCommand("/test/aq/root");

    // Check that git info was displayed
    const output = consoleLogs.join("\n");
    expect(output).toContain("1. Git 정보 감지");
    expect(output).toContain("✓ 저장소: owner/repo");
    expect(output).toContain("✓ 기본 브랜치: main");
    expect(output).toContain("3. config.yml 업데이트");
    expect(output).toContain("✓ 프로젝트 'owner/repo' 등록 완료");
    expect(output).toContain("=== Init 완료 ===");

    // Verify initProject was called with correct parameters
    expect(configLoader.initProject).toHaveBeenCalledWith("/test/aq/root", {
      repo: "owner/repo",
      path: "/test/current/dir",
      baseBranch: "main",
      mode: undefined,
      force: undefined,
    });
  });

  it("should exit with error when git detection fails", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      error: "Git repository not found"
    });

    await expect(runInitCommand("/test/aq/root")).rejects.toThrow("process.exit(1)");

    const output = consoleErrors.join("\n");
    expect(output).toContain("❌ Git repository not found");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit with error when no repository is detected", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: undefined,
      baseBranch: "main"
    });

    await expect(runInitCommand("/test/aq/root")).rejects.toThrow("process.exit(1)");

    const output = consoleErrors.join("\n");
    expect(output).toContain("❌ GitHub 저장소를 감지할 수 없습니다");
    expect(output).toContain("git remote가 설정되어 있는지 확인하거나 --repo 옵션을 사용하세요");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should use provided repo option", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "auto/detected",
      baseBranch: "main"
    });
    vi.spyOn(configLoader, "initProject").mockResolvedValue();

    const options: InitCommandOptions = {
      repo: "override/repo"
    };

    await runInitCommand("/test/aq/root", options);

    expect(configLoader.initProject).toHaveBeenCalledWith("/test/aq/root", {
      repo: "override/repo",
      path: "/test/current/dir",
      baseBranch: "main",
      mode: undefined,
      force: undefined,
    });

    const output = consoleLogs.join("\n");
    expect(output).toContain("✓ 저장소: override/repo");
  });

  it("should handle dry-run mode correctly", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "owner/repo",
      baseBranch: "main"
    });

    // Mock initProject but it should not be called in dry-run mode
    const initProjectSpy = vi.spyOn(configLoader, "initProject").mockResolvedValue();

    const options: InitCommandOptions = {
      dryRun: true,
      mode: "content"
    };

    await runInitCommand("/test/aq/root", options);

    // Verify initProject was NOT called in dry-run mode
    expect(initProjectSpy).not.toHaveBeenCalled();

    const output = consoleLogs.join("\n");
    expect(output).toContain("🔍 Dry run 모드");
    expect(output).toContain("다음 작업이 수행될 예정입니다:");
    expect(output).toContain("config.yml에 프로젝트 'owner/repo' 추가");
    expect(output).toContain("파이프라인 모드: content");
    expect(output).toContain("--dry-run 옵션을 제거하고 다시 실행하세요");
  });

  it("should handle initProject errors", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "owner/repo",
      baseBranch: "main"
    });
    vi.spyOn(configLoader, "initProject").mockRejectedValue(new Error("Config write failed"));

    await expect(runInitCommand("/test/aq/root")).rejects.toThrow("process.exit(1)");

    const output = consoleErrors.join("\n");
    expect(output).toContain("❌ 오류: Config write failed");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should display all options in output when provided", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "auto/detected",
      baseBranch: "auto-branch"
    });
    vi.spyOn(configLoader, "initProject").mockResolvedValue();

    const options: InitCommandOptions = {
      repo: "override/repo",
      path: "/custom/path",
      baseBranch: "develop",
      mode: "content"
    };

    await runInitCommand("/test/aq/root", options);

    const output = consoleLogs.join("\n");
    expect(output).toContain("✓ 저장소: override/repo");
    expect(output).toContain("✓ 경로: /custom/path");
    expect(output).toContain("✓ 기본 브랜치: develop");
    expect(output).toContain("파이프라인 모드: content");

    expect(configLoader.initProject).toHaveBeenCalledWith("/test/aq/root", {
      repo: "override/repo",
      path: "/custom/path",
      baseBranch: "develop",
      mode: "content",
      force: undefined,
    });
  });

  it("should show next steps after successful init", async () => {
    vi.spyOn(configLoader, "detectGitInfo").mockResolvedValue({
      repo: "owner/repo",
      baseBranch: "main"
    });
    vi.spyOn(configLoader, "initProject").mockResolvedValue();

    await runInitCommand("/test/aq/root");

    const output = consoleLogs.join("\n");
    expect(output).toContain("=== Init 완료 ===");
    expect(output).toContain("다음 단계:");
    expect(output).toContain("aqm doctor");
    expect(output).toContain("aqm start");
    expect(output).toContain("aqm start --mode polling");
    expect(output).toContain("사용법:");
    expect(output).toContain("aqm run --issue <번호> --repo owner/repo");
  });
});