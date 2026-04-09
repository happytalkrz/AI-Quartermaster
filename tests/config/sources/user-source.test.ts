import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { UserSource } from "../../../src/config/sources/user-source.js";

function makeContext(projectRoot = "/tmp/project") {
  return { projectRoot };
}

describe("UserSource", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `user-source-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "config.yml");
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("name", () => {
    it("소스 이름이 'user'여야 한다", () => {
      const source = new UserSource(configPath);
      expect(source.name).toBe("user");
    });
  });

  describe("load() — 파일 없음", () => {
    it("설정 파일이 없으면 null을 반환한다", () => {
      const source = new UserSource(join(tmpDir, "nonexistent.yml"));
      const result = source.load(makeContext());
      expect(result).toBeNull();
    });
  });

  describe("load() — 정상 파일", () => {
    it("유효한 YAML 파일을 파싱하여 반환한다", () => {
      writeFileSync(configPath, `
general:
  projectName: "my-project"
  logLevel: "debug"
`);
      const source = new UserSource(configPath);
      const result = source.load(makeContext());

      expect(result).toEqual({
        general: {
          projectName: "my-project",
          logLevel: "debug",
        },
      });
    });

    it("중첩 객체를 올바르게 파싱한다", () => {
      writeFileSync(configPath, `
general:
  dryRun: true
  concurrency: 3
safety:
  maxPhases: 5
  allowedLabels:
    - bug
    - enhancement
`);
      const source = new UserSource(configPath);
      const result = source.load(makeContext());

      expect(result).toEqual({
        general: { dryRun: true, concurrency: 3 },
        safety: { maxPhases: 5, allowedLabels: ["bug", "enhancement"] },
      });
    });

    it("빈 YAML 파일(빈 문서)이면 null을 반환한다", () => {
      writeFileSync(configPath, "");
      const source = new UserSource(configPath);
      const result = source.load(makeContext());
      expect(result).toBeNull();
    });

    it("null YAML 문서이면 null을 반환한다", () => {
      writeFileSync(configPath, "null\n");
      const source = new UserSource(configPath);
      const result = source.load(makeContext());
      expect(result).toBeNull();
    });
  });

  describe("load() — 오류 케이스", () => {
    it("YAML 문법 오류가 있으면 에러를 던진다", () => {
      writeFileSync(configPath, "key: [unclosed");
      const source = new UserSource(configPath);
      expect(() => source.load(makeContext())).toThrow();
    });

    it("최상위 값이 배열이면 에러를 던진다", () => {
      writeFileSync(configPath, "- item1\n- item2\n");
      const source = new UserSource(configPath);
      expect(() => source.load(makeContext())).toThrow(/객체여야/);
    });

    it("최상위 값이 스칼라이면 에러를 던진다", () => {
      writeFileSync(configPath, "just-a-string\n");
      const source = new UserSource(configPath);
      expect(() => source.load(makeContext())).toThrow(/객체여야/);
    });
  });

  describe("기본 경로", () => {
    it("configPath를 생략하면 기본값(~/.aqm/config.yml)을 사용한다", () => {
      const source = new UserSource();
      // 기본 경로는 존재하지 않을 가능성이 높으므로 null 또는 객체를 반환
      // 에러가 발생하지 않아야 함
      expect(() => source.load(makeContext())).not.toThrow();
    });
  });
});
