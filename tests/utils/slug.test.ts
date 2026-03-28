import { describe, it, expect } from "vitest";
import { createSlug } from "../../src/utils/slug.js";

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
});
