import { describe, it, expect } from "vitest";
import {
  getPreset,
  listPresets,
  computePresetDiff,
  type PresetName,
  type ConfigPreset,
} from "../src/config/presets.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { CLAUDE_MODELS } from "../src/claude/model-constants.js";

const PRESET_NAMES: PresetName[] = ["economy", "standard", "thorough", "team", "solo"];

const REQUIRED_FIELDS: (keyof ConfigPreset)[] = [
  "name",
  "description",
  "maxConcurrentJobs",
  "reviewEnabled",
  "reviewRounds",
  "reviewUnifiedMode",
  "simplifyEnabled",
  "executionMode",
  "claudeTimeout",
  "models",
];

const MODEL_ROUTING_FIELDS = ["plan", "phase", "review", "fallback"] as const;

describe("config presets", () => {
  describe("listPresets / getPreset", () => {
    it("5개 프리셋이 모두 존재한다", () => {
      const presets = listPresets();
      const names = presets.map((p) => p.name);
      expect(names).toHaveLength(5);
      for (const name of PRESET_NAMES) {
        expect(names).toContain(name);
      }
    });

    it("getPreset으로 각 프리셋을 개별 조회할 수 있다", () => {
      for (const name of PRESET_NAMES) {
        const preset = getPreset(name);
        expect(preset.name).toBe(name);
      }
    });
  });

  describe("필수 필드 완전성", () => {
    for (const name of PRESET_NAMES) {
      it(`${name}: 모든 필수 필드가 정의되어 있다`, () => {
        const preset = getPreset(name);
        for (const field of REQUIRED_FIELDS) {
          expect(preset[field]).toBeDefined();
        }
      });

      it(`${name}: models에 plan/phase/review/fallback이 모두 있다`, () => {
        const { models } = getPreset(name);
        for (const key of MODEL_ROUTING_FIELDS) {
          expect(models[key]).toBeTruthy();
        }
      });

      it(`${name}: reviewRounds가 음수가 아니다`, () => {
        const preset = getPreset(name);
        expect(preset.reviewRounds).toBeGreaterThanOrEqual(0);
      });

      it(`${name}: claudeTimeout이 양수다`, () => {
        const preset = getPreset(name);
        expect(preset.claudeTimeout).toBeGreaterThan(0);
      });

      it(`${name}: maxConcurrentJobs가 1 이상이다`, () => {
        const preset = getPreset(name);
        expect(preset.maxConcurrentJobs).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("computePresetDiff — 변경된 필드만 반환", () => {
    it("현재 config와 동일한 값이면 diff가 비어있다", () => {
      // standard 프리셋 값과 일치하는 config를 직접 구성
      const standardPreset = getPreset("standard");
      const config = structuredClone(DEFAULT_CONFIG);
      config.general.concurrency = standardPreset.maxConcurrentJobs;
      config.review.enabled = standardPreset.reviewEnabled;
      config.review.rounds = new Array(standardPreset.reviewRounds).fill(
        DEFAULT_CONFIG.review.rounds[0],
      );
      config.review.unifiedMode = standardPreset.reviewUnifiedMode;
      config.review.simplify.enabled = standardPreset.simplifyEnabled;
      config.executionMode = standardPreset.executionMode;
      config.commands.claudeCli.timeout = standardPreset.claudeTimeout;
      config.commands.claudeCli.models = { ...standardPreset.models };

      const diff = computePresetDiff(config, "standard");
      expect(diff).toHaveLength(0);
    });

    it("변경된 필드만 diff에 포함된다", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      // economy 프리셋은 reviewEnabled=false, simplifyEnabled=false 등 DEFAULT와 다름
      const diff = computePresetDiff(config, "economy");
      const diffFields = diff.map((d) => d.field);

      // economy는 reviewEnabled를 false로 바꾸므로 diff에 포함되어야 함
      expect(diffFields).toContain("reviewEnabled");
      // economy는 simplifyEnabled를 false로 바꾸므로 포함되어야 함
      expect(diffFields).toContain("simplifyEnabled");
    });

    it("diff 각 항목에 field, label, currentValue, presetValue가 있다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      expect(diff.length).toBeGreaterThan(0);
      for (const entry of diff) {
        expect(entry.field).toBeTruthy();
        expect(entry.label).toBeTruthy();
        expect(entry).toHaveProperty("currentValue");
        expect(entry).toHaveProperty("presetValue");
      }
    });

    it("diff currentValue는 실제 config 값과 일치한다", () => {
      const config = structuredClone(DEFAULT_CONFIG);
      const diff = computePresetDiff(config, "economy");

      const reviewEnabledEntry = diff.find((d) => d.field === "reviewEnabled");
      if (reviewEnabledEntry) {
        expect(reviewEnabledEntry.currentValue).toBe(config.review.enabled);
      }

      const execModeEntry = diff.find((d) => d.field === "executionMode");
      if (execModeEntry) {
        expect(execModeEntry.currentValue).toBe(config.executionMode);
      }
    });
  });

  describe("Basic 필드만 덮어쓰기 — Advanced 필드 보존", () => {
    it("computePresetDiff는 safety 설정을 변경하지 않는다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const diffFields = diff.map((d) => d.field);
      expect(diffFields).not.toContain("sensitivePaths");
      expect(diffFields).not.toContain("maxPhases");
      expect(diffFields).not.toContain("maxRetries");
      expect(diffFields).not.toContain("blockDirectBasePush");
    });

    it("computePresetDiff는 git 설정을 변경하지 않는다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const diffFields = diff.map((d) => d.field);
      expect(diffFields).not.toContain("defaultBaseBranch");
      expect(diffFields).not.toContain("branchTemplate");
      expect(diffFields).not.toContain("remoteAlias");
    });

    it("computePresetDiff는 PR 설정을 변경하지 않는다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      const diffFields = diff.map((d) => d.field);
      expect(diffFields).not.toContain("draft");
      expect(diffFields).not.toContain("autoMerge");
      expect(diffFields).not.toContain("mergeMethod");
    });

    it("diff 필드는 ConfigPreset 키 범위를 벗어나지 않는다", () => {
      const allowedFields = new Set<string>([
        "maxConcurrentJobs",
        "reviewEnabled",
        "reviewRounds",
        "reviewUnifiedMode",
        "simplifyEnabled",
        "executionMode",
        "claudeTimeout",
        "models",
      ]);
      for (const name of PRESET_NAMES) {
        const diff = computePresetDiff(DEFAULT_CONFIG, name);
        for (const entry of diff) {
          expect(allowedFields).toContain(entry.field);
        }
      }
    });
  });

  describe("DEFAULT_CONFIG 기준 economy/thorough diff 값 검증", () => {
    it("economy: reviewEnabled가 false로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      const entry = diff.find((d) => d.field === "reviewEnabled");
      expect(entry).toBeDefined();
      expect(entry?.currentValue).toBe(true);
      expect(entry?.presetValue).toBe(false);
    });

    it("economy: simplifyEnabled가 false로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      const entry = diff.find((d) => d.field === "simplifyEnabled");
      expect(entry).toBeDefined();
      expect(entry?.currentValue).toBe(true);
      expect(entry?.presetValue).toBe(false);
    });

    it("economy: claudeTimeout이 300000으로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      const entry = diff.find((d) => d.field === "claudeTimeout");
      expect(entry).toBeDefined();
      expect(entry?.presetValue).toBe(300000);
    });

    it("economy: executionMode가 economy로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "economy");
      const entry = diff.find((d) => d.field === "executionMode");
      expect(entry).toBeDefined();
      expect(entry?.currentValue).toBe("standard");
      expect(entry?.presetValue).toBe("economy");
    });

    it("thorough: reviewRounds가 3으로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const entry = diff.find((d) => d.field === "reviewRounds");
      expect(entry).toBeDefined();
      expect(entry?.presetValue).toBe(3);
    });

    it("thorough: reviewUnifiedMode가 true로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const entry = diff.find((d) => d.field === "reviewUnifiedMode");
      expect(entry).toBeDefined();
      expect(entry?.currentValue).toBe(false);
      expect(entry?.presetValue).toBe(true);
    });

    it("thorough: executionMode가 thorough로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const entry = diff.find((d) => d.field === "executionMode");
      expect(entry).toBeDefined();
      expect(entry?.presetValue).toBe("thorough");
    });

    it("thorough: models.phase가 opus로 변경된다", () => {
      const diff = computePresetDiff(DEFAULT_CONFIG, "thorough");
      const entry = diff.find((d) => d.field === "models");
      expect(entry).toBeDefined();
      expect((entry?.presetValue as { phase: string }).phase).toBe(CLAUDE_MODELS.OPUS);
    });
  });
});
