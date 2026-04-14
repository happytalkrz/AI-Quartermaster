import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { loadTemplate, renderTemplate } from "../../src/prompt/template-renderer.js";

const templatesDir = resolve(process.cwd(), "prompts/issue-templates");

const sampleVars = {
  what: "로그인 세션이 만료되는 문제",
  where: "src/auth/login.ts",
  how: "토큰 갱신 로직 점검",
  files: "src/auth/login.ts, src/auth/token.ts"
};

function loadAndRender(category: string): string {
  const templatePath = resolve(templatesDir, `${category}.md`);
  const template = loadTemplate(templatePath, templatesDir);
  return renderTemplate(template, sampleVars);
}

describe("issue-templates: bug.md", () => {
  it("변수를 올바르게 치환한다", () => {
    const result = loadAndRender("bug");
    expect(result).toContain(sampleVars.what);
    expect(result).toContain(sampleVars.where);
    expect(result).toContain(sampleVars.how);
    expect(result).toContain(sampleVars.files);
  });

  it("버그 리포트 섹션 헤더를 포함한다", () => {
    const result = loadAndRender("bug");
    expect(result).toContain("버그 리포트");
  });

  it("미치환 변수가 남지 않는다", () => {
    const result = loadAndRender("bug");
    expect(result).not.toMatch(/\{\{what\}\}/);
    expect(result).not.toMatch(/\{\{where\}\}/);
    expect(result).not.toMatch(/\{\{how\}\}/);
    expect(result).not.toMatch(/\{\{files\}\}/);
  });
});

describe("issue-templates: feature.md", () => {
  it("변수를 올바르게 치환한다", () => {
    const result = loadAndRender("feature");
    expect(result).toContain(sampleVars.what);
    expect(result).toContain(sampleVars.where);
    expect(result).toContain(sampleVars.how);
    expect(result).toContain(sampleVars.files);
  });

  it("기능 요청 섹션 헤더를 포함한다", () => {
    const result = loadAndRender("feature");
    expect(result).toContain("기능 요청");
  });

  it("미치환 변수가 남지 않는다", () => {
    const result = loadAndRender("feature");
    expect(result).not.toMatch(/\{\{what\}\}/);
    expect(result).not.toMatch(/\{\{where\}\}/);
    expect(result).not.toMatch(/\{\{how\}\}/);
    expect(result).not.toMatch(/\{\{files\}\}/);
  });
});

describe("issue-templates: refactor.md", () => {
  it("변수를 올바르게 치환한다", () => {
    const result = loadAndRender("refactor");
    expect(result).toContain(sampleVars.what);
    expect(result).toContain(sampleVars.where);
    expect(result).toContain(sampleVars.how);
    expect(result).toContain(sampleVars.files);
  });

  it("리팩터링 섹션 헤더를 포함한다", () => {
    const result = loadAndRender("refactor");
    expect(result).toContain("리팩터링");
  });

  it("미치환 변수가 남지 않는다", () => {
    const result = loadAndRender("refactor");
    expect(result).not.toMatch(/\{\{what\}\}/);
    expect(result).not.toMatch(/\{\{where\}\}/);
    expect(result).not.toMatch(/\{\{how\}\}/);
    expect(result).not.toMatch(/\{\{files\}\}/);
  });
});

describe("issue-templates: docs.md", () => {
  it("변수를 올바르게 치환한다", () => {
    const result = loadAndRender("docs");
    expect(result).toContain(sampleVars.what);
    expect(result).toContain(sampleVars.where);
    expect(result).toContain(sampleVars.how);
    expect(result).toContain(sampleVars.files);
  });

  it("문서 작업 섹션 헤더를 포함한다", () => {
    const result = loadAndRender("docs");
    expect(result).toContain("문서 작업");
  });

  it("미치환 변수가 남지 않는다", () => {
    const result = loadAndRender("docs");
    expect(result).not.toMatch(/\{\{what\}\}/);
    expect(result).not.toMatch(/\{\{where\}\}/);
    expect(result).not.toMatch(/\{\{how\}\}/);
    expect(result).not.toMatch(/\{\{files\}\}/);
  });
});
