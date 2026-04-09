import { describe, it, expect } from "vitest";
import { EnvSource } from "../../../src/config/sources/env-source.js";
import type { LoadContext } from "../../../src/config/sources/types.js";

const makeContext = (envVars?: Record<string, string | undefined>): LoadContext => ({
  projectRoot: "/tmp/test-project",
  envVars,
});

describe("EnvSource", () => {
  it("name이 'env'이어야 한다", () => {
    const source = new EnvSource();
    expect(source.name).toBe("env");
  });

  it("AQM_* 환경변수를 파싱하여 config 객체를 반환한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_GENERAL_PROJECT_NAME: "test-project",
      AQM_GENERAL_LOG_LEVEL: "debug",
    }));

    expect(result).toEqual({
      general: {
        projectName: "test-project",
        logLevel: "debug",
      },
    });
  });

  it("숫자 값을 올바르게 파싱한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_GENERAL_CONCURRENCY: "3",
      AQM_SAFETY_MAX_PHASES: "10",
    }));

    expect(result).toEqual({
      general: { concurrency: 3 },
      safety: { maxPhases: 10 },
    });
  });

  it("불리언 값을 올바르게 파싱한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_GENERAL_DRY_RUN: "true",
      AQM_SAFETY_REQUIRE_TESTS: "false",
    }));

    expect(result).toEqual({
      general: { dryRun: true },
      safety: { requireTests: false },
    });
  });

  it("콤마 구분 배열을 올바르게 파싱한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_GIT_ALLOWED_REPOS: "owner/repo1,owner/repo2",
    }));

    expect(result).toEqual({
      git: { allowedRepos: ["owner/repo1", "owner/repo2"] },
    });
  });

  it("AQM_* 변수가 없으면 null을 반환한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      PATH: "/usr/bin",
      USER: "test",
    }));

    expect(result).toBeNull();
  });

  it("빈 envVars이면 null을 반환한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({}));

    expect(result).toBeNull();
  });

  it("AQM_* 이외의 환경변수는 무시한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      NOT_AQM_VAR: "ignored",
      AQM_GENERAL_PROJECT_NAME: "included",
    }));

    expect(result).toEqual({
      general: { projectName: "included" },
    });
  });

  it("context.envVars가 없으면 process.env를 사용한다", () => {
    const source = new EnvSource();
    // process.env를 직접 사용하므로 에러 없이 실행되어야 함
    expect(() => source.load({ projectRoot: "/tmp" })).not.toThrow();
  });

  it("undefined 환경변수 값은 무시한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_GENERAL_PROJECT_NAME: "test",
      AQM_GENERAL_LOG_LEVEL: undefined,
    }));

    expect(result).toEqual({
      general: { projectName: "test" },
    });
  });

  it("SECTION만 있고 KEY가 없는 형식은 무시한다", () => {
    const source = new EnvSource();
    const result = source.load(makeContext({
      AQM_SECTION: "ignored",
      AQM_GENERAL_VALID: "included",
    }));

    expect(result).toEqual({
      general: { valid: "included" },
    });
  });
});
