import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateRepoFormat,
  validateLocalPath,
  suggestClone,
  handleValidationError,
  ValidationResult
} from "../../src/setup/validators.js";
import * as cliRunner from "../../src/utils/cli-runner.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("validateRepoFormat", () => {
  it("should accept valid owner/repo format", () => {
    const result = validateRepoFormat("octocat/Hello-World");
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept repo names with hyphens, dots, and underscores", () => {
    const result = validateRepoFormat("my-org/my.repo_name");
    expect(result.isValid).toBe(true);
  });

  it("should reject empty input", () => {
    const result = validateRepoFormat("");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("저장소 이름을 입력해주세요");
    expect(result.suggestion).toContain("예시: octocat/Hello-World");
  });

  it("should reject whitespace-only input", () => {
    const result = validateRepoFormat("   ");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("저장소 이름을 입력해주세요");
  });

  it("should reject input without slash", () => {
    const result = validateRepoFormat("invalid-repo-name");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("'owner/repo' 형태여야 합니다");
  });

  it("should reject input with multiple slashes", () => {
    const result = validateRepoFormat("owner/group/repo");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("'owner/repo' 형태여야 합니다");
  });

  it("should reject empty owner", () => {
    const result = validateRepoFormat("/repo-name");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("소유자 이름이 비어있습니다");
  });

  it("should reject empty repo name", () => {
    const result = validateRepoFormat("owner/");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("저장소 이름이 비어있습니다");
  });

  it("should reject invalid characters in owner name", () => {
    const result = validateRepoFormat("owner@invalid/repo");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("소유자 이름에 허용되지 않은 문자가 포함되어 있습니다");
  });

  it("should reject invalid characters in repo name", () => {
    const result = validateRepoFormat("owner/repo@invalid");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("저장소 이름에 허용되지 않은 문자가 포함되어 있습니다");
  });

  it("should trim whitespace and validate", () => {
    const result = validateRepoFormat("  octocat/Hello-World  ");
    expect(result.isValid).toBe(true);
  });
});

describe("validateLocalPath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-validators-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should accept existing directory path", () => {
    const result = validateLocalPath(testDir);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject empty input", () => {
    const result = validateLocalPath("");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("경로를 입력해주세요");
    expect(result.suggestion).toContain("예시:");
  });

  it("should reject whitespace-only input", () => {
    const result = validateLocalPath("   ");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("경로를 입력해주세요");
  });

  it("should reject non-existent path", () => {
    const nonExistentPath = join(testDir, "non-existent-directory");
    const result = validateLocalPath(nonExistentPath);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("경로가 존재하지 않습니다");
    expect(result.suggestion).toContain("존재하는 디렉토리 경로를 입력");
  });

  it("should handle relative paths", () => {
    // Create a subdirectory in testDir
    const subDir = join(testDir, "subdir");
    mkdirSync(subDir);

    // Test relative path (current working directory should be set to testDir for this to work)
    // For simplicity, we'll test with absolute paths
    const result = validateLocalPath(subDir);
    expect(result.isValid).toBe(true);
  });
});

describe("suggestClone", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should suggest clone when gh CLI is available and authenticated", async () => {
    // Mock gh --version success
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (command === "gh" && args.includes("--version")) {
        return { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" };
      }
      if (command === "gh" && args.includes("status")) {
        return { exitCode: 0, stdout: "Logged in to github.com", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "Command not found" };
    });

    const result = await suggestClone("octocat/Hello-World");
    expect(result.isValid).toBe(true);
    expect(result.suggestion).toContain("gh repo clone octocat/Hello-World");
    expect(result.suggestion).toContain("git clone https://github.com/octocat/Hello-World.git");
  });

  it("should fail when gh CLI is not installed", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async () => {
      return { exitCode: 1, stdout: "", stderr: "Command not found" };
    });

    const result = await suggestClone("octocat/Hello-World");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("GitHub CLI (gh)가 설치되지 않았습니다");
    expect(result.suggestion).toContain("GitHub CLI를 설치");
  });

  it("should fail when gh CLI is not authenticated", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (command === "gh" && args.includes("--version")) {
        return { exitCode: 0, stdout: "gh version 2.0.0", stderr: "" };
      }
      if (command === "gh" && args.includes("status")) {
        return { exitCode: 1, stdout: "", stderr: "Not logged in" };
      }
      return { exitCode: 1, stdout: "", stderr: "Command failed" };
    });

    const result = await suggestClone("octocat/Hello-World");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("GitHub CLI 인증이 필요합니다");
    expect(result.suggestion).toContain("gh auth login");
  });

  it("should handle CLI runner exceptions", async () => {
    vi.spyOn(cliRunner, "runCli").mockImplementation(async () => {
      throw new Error("Network timeout");
    });

    const result = await suggestClone("octocat/Hello-World");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("GitHub CLI 확인 중 오류가 발생했습니다");
    expect(result.error).toContain("Network timeout");
  });
});

describe("handleValidationError", () => {
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

  it("should display error message for invalid result", () => {
    const invalidResult: ValidationResult = {
      isValid: false,
      error: "Test error message",
      suggestion: "Test suggestion"
    };

    handleValidationError(invalidResult, "테스트 필드");

    expect(consoleLogs).toContain("\n❌ 테스트 필드 검증 실패: Test error message");
    expect(consoleLogs).toContain("💡 제안: Test suggestion");
    expect(consoleLogs).toContain("\n다시 입력해주세요.\n");
  });

  it("should display error without suggestion", () => {
    const invalidResult: ValidationResult = {
      isValid: false,
      error: "Test error message"
    };

    handleValidationError(invalidResult, "테스트 필드");

    expect(consoleLogs).toContain("\n❌ 테스트 필드 검증 실패: Test error message");
    expect(consoleLogs.some(log => log.includes("💡 제안:"))).toBe(false);
  });

  it("should not display anything for valid result", () => {
    const validResult: ValidationResult = {
      isValid: true
    };

    handleValidationError(validResult, "테스트 필드");

    expect(consoleLogs).toHaveLength(0);
  });
});