/**
 * Settings 페이지 Advanced 탭 스키마 키 커버리지 테스트
 *
 * 검증 내용:
 *  - ADVANCED_SECTION_KEYS가 5개 섹션을 올바른 configPath로 포함하는지
 *  - Basic 탭과 Advanced 탭 간 configPath 중복이 없는지
 *  - Basic + Advanced 합집합이 AQConfig 주요 섹션을 커버하는지
 */
import { describe, it, expect } from "vitest";
import { BASIC_FIELD_METAS, ADVANCED_SECTION_KEYS } from "../src/config/schema-meta.js";

describe("Advanced 탭 ADVANCED_SECTION_KEYS", () => {
  it("5개 섹션을 포함한다", () => {
    expect(ADVANCED_SECTION_KEYS).toHaveLength(5);
  });

  it("예상 configPath를 모두 포함한다", () => {
    const keys = ADVANCED_SECTION_KEYS as readonly string[];
    expect(keys).toContain("hooks");
    expect(keys).toContain("commands.claudeCli.retry");
    expect(keys).toContain("commands.claudeCli.models");
    expect(keys).toContain("allowedTools");
    expect(keys).toContain("safety.sensitivePaths");
  });
});

describe("Basic ↔ Advanced 중복 없음", () => {
  it("Basic과 Advanced가 동일한 configPath를 공유하지 않는다", () => {
    const basicKeys = BASIC_FIELD_METAS.map((m) => m.key);
    const advancedKeys = ADVANCED_SECTION_KEYS as readonly string[];

    const overlap = basicKeys.filter((k) => advancedKeys.includes(k));
    expect(overlap).toHaveLength(0);
  });
});

describe("AQConfig 주요 섹션 커버리지", () => {
  it("Basic + Advanced가 AQConfig 주요 섹션을 최소 1개 이상 커버한다", () => {
    const basicKeys = BASIC_FIELD_METAS.map((m) => m.key);
    const advancedKeys = [...(ADVANCED_SECTION_KEYS as readonly string[])];
    const allCoveredKeys = [...basicKeys, ...advancedKeys];

    // AQConfig 최상위 섹션 중 UI에서 관리하는 주요 섹션
    const expectedSectionPrefixes = [
      "general",       // general.concurrency, general.pollingIntervalMs 등 (Basic)
      "git",           // git.defaultBaseBranch (Basic)
      "commands",      // commands.claudeCli.timeout (Basic), .retry/.models (Advanced)
      "safety",        // safety.allowedLabels (Basic), safety.sensitivePaths (Advanced)
      "hooks",         // hooks (Advanced)
      "executionMode", // executionMode (Basic, 최상위 scalar)
    ];

    for (const prefix of expectedSectionPrefixes) {
      const covered = allCoveredKeys.some(
        (k) => k === prefix || k.startsWith(prefix + ".")
      );
      expect(covered, `"${prefix}" 섹션이 Basic 또는 Advanced에 커버되지 않음`).toBe(true);
    }
  });
});
