import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkFileScope, checkDuplicateExtension } from "../../src/safety/scope-guard.js";
import { SafetyViolationError } from "../../src/types/errors.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { existsSync } from "node:fs";

describe("checkFileScope", () => {
  it("빈 targetFiles이면 아무 동작 없이 통과", () => {
    expect(() => checkFileScope(["src/foo.ts", "src/bar.ts"], [])).not.toThrow();
  });

  it("모든 파일이 targetFiles 내에 있으면 통과", () => {
    expect(() =>
      checkFileScope(["src/foo.ts", "src/bar.ts"], ["src/foo.ts", "src/bar.ts"])
    ).not.toThrow();
  });

  it("prefix가 일치하면 스코프 내로 처리", () => {
    expect(() =>
      checkFileScope(["src/components/Button.tsx"], ["src/components"])
    ).not.toThrow();
  });

  it("스코프 외 파일이 있어도 throw하지 않는다 (경고만)", () => {
    expect(() =>
      checkFileScope(["src/unrelated.ts"], ["src/target.ts"])
    ).not.toThrow();
  });

  it("일부는 스코프 내, 일부는 스코프 외여도 throw하지 않는다", () => {
    expect(() =>
      checkFileScope(["src/target.ts", "src/other.ts"], ["src/target.ts"])
    ).not.toThrow();
  });

  it("changedFiles가 비어 있으면 통과", () => {
    expect(() => checkFileScope([], ["src/target.ts"])).not.toThrow();
  });
});

describe("checkDuplicateExtension", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it(".js 파일이 없으면 통과", () => {
    expect(() => checkDuplicateExtension(["src/foo.ts", "src/bar.tsx"], "/cwd")).not.toThrow();
  });

  it(".js 파일이 있지만 대응하는 .ts/.tsx가 없으면 통과", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(() => checkDuplicateExtension(["src/foo.js"], "/cwd")).not.toThrow();
  });

  it(".js 파일과 같은 이름의 .ts가 존재하면 SafetyViolationError를 던진다", () => {
    vi.mocked(existsSync).mockImplementation((p) => (p as string).endsWith(".ts"));
    expect(() => checkDuplicateExtension(["src/foo.js"], "/cwd")).toThrow(SafetyViolationError);
  });

  it(".js 파일과 같은 이름의 .tsx가 존재하면 SafetyViolationError를 던진다", () => {
    vi.mocked(existsSync).mockImplementation((p) => (p as string).endsWith(".tsx"));
    expect(() => checkDuplicateExtension(["src/foo.js"], "/cwd")).toThrow(SafetyViolationError);
  });

  it("에러 메시지에 ScopeGuard 가드명이 포함된다", () => {
    vi.mocked(existsSync).mockImplementation((p) => (p as string).endsWith(".ts"));
    expect(() => checkDuplicateExtension(["src/foo.js"], "/cwd")).toThrow("ScopeGuard");
  });

  it("여러 .js 파일이 .ts와 중복되면 모두 violations에 포함된다", () => {
    vi.mocked(existsSync).mockImplementation((p) => (p as string).endsWith(".ts"));
    let caught: SafetyViolationError | null = null;
    try {
      checkDuplicateExtension(["src/a.js", "src/b.js"], "/cwd");
    } catch (err) {
      caught = err as SafetyViolationError;
    }
    expect(caught).toBeInstanceOf(SafetyViolationError);
    const violations = caught?.details?.["violations"] as string[];
    expect(violations).toHaveLength(2);
  });

  it("changedFiles가 비어 있으면 통과", () => {
    expect(() => checkDuplicateExtension([], "/cwd")).not.toThrow();
  });
});
