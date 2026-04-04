import { describe, it, expect } from "vitest";
import { createSlug, isPathSafe, createSlugWithFallback } from "../../src/utils/slug.js";

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

  it("should return false for absolute paths", () => {
    expect(isPathSafe("/etc/passwd")).toBe(false);
    expect(isPathSafe("\\windows\\system32")).toBe(false);
    expect(isPathSafe("C:\\Windows")).toBe(false);
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

describe("createSlugWithFallback", () => {
  it("should use fallback for empty slug", () => {
    expect(createSlugWithFallback("")).toBe("impl");
    expect(createSlugWithFallback("한글만")).toBe("impl");
    expect(createSlugWithFallback("한글만", "custom")).toBe("custom");
  });
});
