import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadTemplate } from "../../src/prompt/template-renderer.js";
import { isPathSafe, isDirectoryNameSafe } from "../../src/utils/slug.js";

// loadTemplate이 fs.readFileSync를 사용하므로 모킹
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

const mockReadFileSync = vi.mocked(await import("fs")).readFileSync;

describe("isPathSafe — 경로 순회 패턴 차단", () => {
  it("안전한 상대 경로는 허용한다", () => {
    expect(isPathSafe("prompts/implement.md")).toBe(true);
    expect(isPathSafe("docs/guide.md")).toBe(true);
    expect(isPathSafe("src/components/Button.tsx")).toBe(true);
  });

  it("../ 경로 순회를 차단한다", () => {
    expect(isPathSafe("../etc/passwd")).toBe(false);
    expect(isPathSafe("../../root/.ssh/id_rsa")).toBe(false);
    expect(isPathSafe("prompts/../../../etc/shadow")).toBe(false);
  });

  it("./ 현재 디렉토리 접두어를 차단한다", () => {
    expect(isPathSafe("./relative")).toBe(false);
  });

  it("절대 경로는 허용한다 (프로젝트 로컬 경로에 필요)", () => {
    expect(isPathSafe("/etc/passwd")).toBe(true);
    expect(isPathSafe("/home/user/project")).toBe(true);
  });

  it("연속 슬래시(//)를 차단한다", () => {
    expect(isPathSafe("prompts//../../etc")).toBe(false);
  });

  it("제어 문자를 차단한다", () => {
    expect(isPathSafe("file\x00name")).toBe(false);
    expect(isPathSafe("file\x1fname")).toBe(false);
  });

  it("Windows 금지 문자를 차단한다", () => {
    expect(isPathSafe("file<name>")).toBe(false);
    expect(isPathSafe("file:name")).toBe(false);
    expect(isPathSafe('file"name')).toBe(false);
    expect(isPathSafe("file|name")).toBe(false);
    expect(isPathSafe("file?name")).toBe(false);
    expect(isPathSafe("file*name")).toBe(false);
  });

  it("빈 문자열과 비문자열을 차단한다", () => {
    expect(isPathSafe("")).toBe(false);
    // @ts-expect-error 잘못된 타입 입력 테스트
    expect(isPathSafe(null)).toBe(false);
    // @ts-expect-error 잘못된 타입 입력 테스트
    expect(isPathSafe(undefined)).toBe(false);
  });
});

describe("isDirectoryNameSafe — 디렉토리명 순회 차단", () => {
  it("안전한 디렉토리명을 허용한다", () => {
    expect(isDirectoryNameSafe("prompts")).toBe(true);
    expect(isDirectoryNameSafe("my-project")).toBe(true);
    expect(isDirectoryNameSafe("project_v2")).toBe(true);
  });

  it("슬래시 포함 디렉토리명을 차단한다", () => {
    expect(isDirectoryNameSafe("dir/subdir")).toBe(false);
    expect(isDirectoryNameSafe("../escape")).toBe(false);
  });

  it("백슬래시 포함 디렉토리명을 차단한다", () => {
    expect(isDirectoryNameSafe("dir\\subdir")).toBe(false);
  });
});

describe("loadTemplate — allowedDir 경계 검증", () => {
  const allowedDir = "/safe/prompts";

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue("template content" as unknown as Buffer);
  });

  it("허용된 디렉토리 내 경로는 정상 로드된다", () => {
    const result = loadTemplate("/safe/prompts/implement.md", allowedDir);
    expect(result).toBe("template content");
  });

  it("../ 순회로 허용 디렉토리 탈출 시 에러를 던진다", () => {
    expect(() =>
      loadTemplate("/safe/prompts/../../../etc/passwd", allowedDir)
    ).toThrow("Template path is outside the allowed directory");
  });

  it("절대 경로로 allowedDir 외부 파일 접근 시 에러를 던진다", () => {
    expect(() =>
      loadTemplate("/etc/shadow", allowedDir)
    ).toThrow("Template path is outside the allowed directory");
  });

  it("부분 일치 경로(prefix spoofing) 차단: /safe/prompts-evil/...", () => {
    expect(() =>
      loadTemplate("/safe/prompts-evil/file.md", allowedDir)
    ).toThrow("Template path is outside the allowed directory");
  });

  it("null byte 주입 경로를 차단한다", () => {
    expect(() =>
      loadTemplate("/safe/prompts/file.md\x00/../../etc/passwd", allowedDir)
    ).toThrow();
  });

  it("allowedDir 미지정 시 경계 검증 없이 로드한다 (경계 없음)", () => {
    // allowedDir 없이는 경로 순회 제한 없음 — 파일이 있으면 바로 로드됨
    const result = loadTemplate("/any/path/file.md");
    expect(result).toBe("template content");
  });

  it("파일이 없으면 명확한 에러 메시지를 반환한다", () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    expect(() =>
      loadTemplate("/safe/prompts/missing.md", allowedDir)
    ).toThrow("Template file not found:");
  });
});
