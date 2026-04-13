import { describe, it, expect } from "vitest";
import {
  checkSensitivePaths,
  parseRelatedFilesSection,
} from "../../src/safety/sensitive-path-guard.js";
import { SafetyViolationError } from "../../src/types/errors.js";

describe("checkSensitivePaths", () => {
  const patterns = [".env*", "**/*.pem", "**/secrets/**", ".github/workflows/**"];

  it("should pass when no sensitive files are changed", () => {
    expect(() => checkSensitivePaths(["src/app.ts", "tests/app.test.ts"], patterns)).not.toThrow();
  });

  it("should throw on .env file", () => {
    expect(() => checkSensitivePaths([".env.local"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on .pem file", () => {
    expect(() => checkSensitivePaths(["certs/server.pem"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on secrets directory", () => {
    expect(() => checkSensitivePaths(["config/secrets/api-key.json"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should throw on GitHub workflows", () => {
    expect(() => checkSensitivePaths([".github/workflows/deploy.yml"], patterns)).toThrow("SensitivePathGuard");
  });

  it("should list all violations in error", () => {
    try {
      checkSensitivePaths([".env", "key.pem"], [".env*", "**/*.pem"]);
    } catch (e: unknown) {
      expect((e as SafetyViolationError).details?.violations).toHaveLength(2);
    }
  });

  describe("판정 매트릭스 — 5케이스", () => {
    it("케이스 1: sensitive 변경 없음 → 통과 (no-match)", () => {
      const result = checkSensitivePaths(
        ["src/app.ts", "tests/app.test.ts"],
        patterns
      );
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.decision === "allowed" && e.reason === "no-match")).toBe(true);
    });

    it("케이스 2: sensitive 파일 + 관련파일 명시 → 통과 (related-file)", () => {
      const issueBody = [
        "## 관련 파일",
        "- `.github/workflows/ci.yml`",
      ].join("\n");
      const result = checkSensitivePaths(
        [".github/workflows/ci.yml"],
        patterns,
        { issueBody }
      );
      expect(result).toHaveLength(1);
      expect(result[0].decision).toBe("allowed");
      expect(result[0].reason).toBe("related-file");
    });

    it("케이스 3: sensitive workflow + allow-ci 라벨 + 관련파일 명시 → 통과 + 감사로그 allow-ci-label", () => {
      const issueBody = [
        "## 관련 파일",
        "- `.github/workflows/deploy.yml`",
      ].join("\n");
      const result = checkSensitivePaths(
        [".github/workflows/deploy.yml"],
        patterns,
        { labels: ["allow-ci"], issueBody }
      );
      expect(result).toHaveLength(1);
      expect(result[0].decision).toBe("allowed");
      expect(result[0].reason).toBe("allow-ci-label");
      expect(result[0].matchedPattern).toBe(".github/workflows/**");
    });

    it("케이스 4: allow-ci 단독 (non-workflow sensitive 파일) → 차단", () => {
      expect(() =>
        checkSensitivePaths([".env.local"], patterns, { labels: ["allow-ci"] })
      ).toThrow("SensitivePathGuard");
    });

    it("케이스 4-b: workflow + allow-ci 단독 (관련파일 미선언) → 차단", () => {
      expect(() =>
        checkSensitivePaths([".github/workflows/deploy.yml"], patterns, { labels: ["allow-ci"] })
      ).toThrow("SensitivePathGuard");
    });

    it("케이스 5: sensitive 파일 + 관련파일 없음 → 차단", () => {
      expect(() =>
        checkSensitivePaths([".github/workflows/ci.yml"], patterns)
      ).toThrow("SensitivePathGuard");
    });
  });

  describe("엣지 케이스", () => {
    it("케이스 6: 관련파일에 non-sensitive만 존재 — sensitive 파일은 차단 유지", () => {
      // 이슈 본문에 src/app.ts만 명시 → .github/workflows/ci.yml은 차단되어야 함
      const issueBody = [
        "## 관련 파일",
        "- `src/app.ts`",
      ].join("\n");
      expect(() =>
        checkSensitivePaths(
          [".github/workflows/ci.yml", "src/app.ts"],
          patterns,
          { issueBody }
        )
      ).toThrow("SensitivePathGuard");
    });

    it("케이스 7: 유사 경로 오탈자 ci.yaml vs ci.yml — literal 불일치 → 차단", () => {
      // 이슈 본문에 ci.yaml 명시, 실제 변경 파일은 ci.yml
      const issueBody = [
        "## 관련 파일",
        "- `.github/workflows/ci.yaml`",
      ].join("\n");
      expect(() =>
        checkSensitivePaths(
          [".github/workflows/ci.yml"],
          patterns,
          { issueBody }
        )
      ).toThrow("SensitivePathGuard");
    });
  });

  describe("감사 로그 구조 검증", () => {
    it("allow-ci 경로의 auditLog는 file, matchedPattern, decision, reason을 모두 포함", () => {
      const issueBody = [
        "## 관련 파일",
        "- `.github/workflows/release.yml`",
      ].join("\n");
      const result = checkSensitivePaths(
        [".github/workflows/release.yml"],
        patterns,
        { labels: ["allow-ci"], issueBody }
      );
      const entry = result[0];
      expect(entry).toHaveProperty("file", ".github/workflows/release.yml");
      expect(entry).toHaveProperty("matchedPattern", ".github/workflows/**");
      expect(entry).toHaveProperty("decision", "allowed");
      expect(entry).toHaveProperty("reason", "allow-ci-label");
    });

    it("차단 시 error.details.auditLog에 전체 판정 이력 포함", () => {
      try {
        checkSensitivePaths(
          ["src/app.ts", ".github/workflows/ci.yml"],
          patterns
        );
      } catch (e: unknown) {
        const err = e as SafetyViolationError;
        expect(err.details?.violations).toEqual([".github/workflows/ci.yml"]);
        const auditLog = err.details?.auditLog as Array<{ file: string; decision: string }>;
        expect(auditLog).toHaveLength(2);
        expect(auditLog.find((a) => a.file === "src/app.ts")?.decision).toBe("allowed");
        expect(auditLog.find((a) => a.file === ".github/workflows/ci.yml")?.decision).toBe("blocked");
      }
    });
  });
});

describe("parseRelatedFilesSection", () => {
  it("## 관련 파일 섹션에서 백틱 경로 추출", () => {
    const body = [
      "## 관련 파일",
      "- `.github/workflows/ci.yml`",
      "- `src/app.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual([
      ".github/workflows/ci.yml",
      "src/app.ts",
    ]);
  });

  it("섹션이 없으면 빈 배열 반환", () => {
    expect(parseRelatedFilesSection("## 다른 섹션\n- `file.ts`\n")).toEqual([]);
  });

  it("빈 문자열은 빈 배열 반환", () => {
    expect(parseRelatedFilesSection("")).toEqual([]);
  });

  it("glob 패턴 포함 경로 제외", () => {
    const body = [
      "## 관련 파일",
      "- `**/*.ts`",
      "- `src/app.ts`",
      "- `{a,b}.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["src/app.ts"]);
  });

  it("fenced code block 내 경로 무시", () => {
    const body = [
      "## 관련 파일",
      "```",
      "- `ignored.ts`",
      "```",
      "- `real.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["real.ts"]);
  });

  it("다음 ## 섹션에서 추출 중단", () => {
    const body = [
      "## 관련 파일",
      "- `file1.ts`",
      "## 다른 섹션",
      "- `file2.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["file1.ts"]);
  });

  it("리스트 항목이 아닌 줄은 무시", () => {
    const body = [
      "## 관련 파일",
      "일반 텍스트 `ignored.ts`",
      "- `real.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["real.ts"]);
  });

  it("백틱 없는 리스트 항목 무시", () => {
    const body = [
      "## 관련 파일",
      "- plain-file.ts",
      "- `backtick.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["backtick.ts"]);
  });

  it("관련 파일 섹션 스페이스 변형 인식 (## 관련파일)", () => {
    const body = [
      "## 관련파일",
      "- `src/main.ts`",
    ].join("\n");
    expect(parseRelatedFilesSection(body)).toEqual(["src/main.ts"]);
  });
});
