import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractDesignReferences } from "../../src/prompt/template-renderer.js";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

const { existsSync } = await import("fs");
const mockExistsSync = vi.mocked(existsSync);

describe("extractDesignReferences", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  describe("경로 추출 — 다양한 마크다운 형식", () => {
    it("백틱으로 감싼 경로를 추출한다", () => {
      const body = "디자인 파일: `docs/design/form-components.html`";
      const { references } = extractDesignReferences(body);
      expect(references.map(r => r.path)).toContain("docs/design/form-components.html");
    });

    it("마크다운 링크 형식([text](path))에서 경로를 추출한다", () => {
      const body = "[디자인](docs/design/form-components.html) 참조";
      const { references } = extractDesignReferences(body);
      expect(references.map(r => r.path)).toContain("docs/design/form-components.html");
    });

    it("일반 텍스트 내 경로를 추출한다", () => {
      const body = "docs/design/form-components.html 파일을 참조하세요.";
      const { references } = extractDesignReferences(body);
      expect(references.map(r => r.path)).toContain("docs/design/form-components.html");
    });

    it("여러 경로를 모두 추출한다", () => {
      const body = [
        "- `docs/design/form-components.html`",
        "- docs/design/button-system.html",
        "- [링크](docs/design/layout.html)",
      ].join("\n");
      const { references } = extractDesignReferences(body);
      const paths = references.map(r => r.path);
      expect(paths).toContain("docs/design/form-components.html");
      expect(paths).toContain("docs/design/button-system.html");
      expect(paths).toContain("docs/design/layout.html");
    });

    it("이슈 본문이 비어 있으면 빈 배열을 반환한다", () => {
      const { references, designFiles } = extractDesignReferences("");
      expect(references).toHaveLength(0);
      expect(designFiles).toHaveLength(0);
    });

    it("docs/design/ 경로가 없으면 빈 배열을 반환한다", () => {
      const body = "일반 텍스트 본문입니다. 디자인 파일 없음.";
      const { references } = extractDesignReferences(body);
      expect(references).toHaveLength(0);
    });
  });

  describe("존재하지 않는 파일 필터링", () => {
    it("파일이 존재하지 않으면 references.exists가 false이다", () => {
      mockExistsSync.mockReturnValue(false);
      const body = "docs/design/missing.html";
      const { references } = extractDesignReferences(body);
      expect(references[0].exists).toBe(false);
    });

    it("파일이 존재하지 않으면 designFiles에 포함되지 않는다", () => {
      mockExistsSync.mockReturnValue(false);
      const body = "docs/design/missing.html";
      const { designFiles } = extractDesignReferences(body);
      expect(designFiles).toHaveLength(0);
    });

    it("파일이 존재하면 references.exists가 true이다", () => {
      mockExistsSync.mockReturnValue(true);
      const body = "docs/design/existing.html";
      const { references } = extractDesignReferences(body);
      expect(references[0].exists).toBe(true);
    });

    it("파일이 존재하면 designFiles에 포함된다", () => {
      mockExistsSync.mockReturnValue(true);
      const body = "docs/design/existing.html";
      const { designFiles } = extractDesignReferences(body);
      expect(designFiles).toContain("docs/design/existing.html");
    });

    it("일부 파일만 존재할 때 존재하는 것만 designFiles에 포함된다", () => {
      mockExistsSync
        .mockReturnValueOnce(true)   // form-components.html — 존재
        .mockReturnValueOnce(false); // missing.html — 없음
      const body = "docs/design/form-components.html docs/design/missing.html";
      const { designFiles } = extractDesignReferences(body);
      expect(designFiles).toContain("docs/design/form-components.html");
      expect(designFiles).not.toContain("docs/design/missing.html");
    });
  });

  describe("중복 제거", () => {
    it("동일한 경로가 여러 번 등장하면 한 번만 반환한다", () => {
      mockExistsSync.mockReturnValue(false);
      const body = [
        "docs/design/form-components.html",
        "docs/design/form-components.html",
        "`docs/design/form-components.html`",
      ].join("\n");
      const { references } = extractDesignReferences(body);
      const paths = references.map(r => r.path);
      expect(paths.filter(p => p === "docs/design/form-components.html")).toHaveLength(1);
    });

    it("중복이 있어도 designFiles에는 한 번만 포함된다", () => {
      mockExistsSync.mockReturnValue(true);
      const body = "docs/design/a.html docs/design/a.html";
      const { designFiles } = extractDesignReferences(body);
      expect(designFiles.filter(p => p === "docs/design/a.html")).toHaveLength(1);
    });
  });

  describe("docs/design/ 외 경로 무시", () => {
    it("docs/design/ 로 시작하지 않는 html 경로는 무시한다", () => {
      const body = "src/components/form.html 참조";
      const { references } = extractDesignReferences(body);
      expect(references).toHaveLength(0);
    });

    it(".html 이 아닌 확장자는 무시한다", () => {
      const body = "docs/design/form.png docs/design/style.css";
      const { references } = extractDesignReferences(body);
      expect(references).toHaveLength(0);
    });

    it("docs/design/ 로 시작하는 경로만 선택적으로 추출한다", () => {
      const body = [
        "docs/design/valid.html",
        "assets/design/other.html",
        "src/design/comp.html",
      ].join("\n");
      const { references } = extractDesignReferences(body);
      const paths = references.map(r => r.path);
      expect(paths).toContain("docs/design/valid.html");
      expect(paths).not.toContain("assets/design/other.html");
      expect(paths).not.toContain("src/design/comp.html");
    });
  });

  describe("cwd 파라미터", () => {
    it("cwd를 지정하면 해당 디렉토리 기준으로 existsSync를 호출한다", () => {
      mockExistsSync.mockReturnValue(false);
      const body = "docs/design/comp.html";
      extractDesignReferences(body, "/custom/base");
      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining("/custom/base")
      );
    });
  });
});
