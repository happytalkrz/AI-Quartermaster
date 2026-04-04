import { describe, it, expect } from "vitest";
import {
  getModePreset,
  detectModeFromLabels,
  getExecutionModePreset,
  detectExecutionModeFromLabels,
} from "../../src/config/mode-presets.js";
import type { PipelineMode, ExecutionMode } from "../../src/types/config.js";

describe("mode-presets", () => {
  describe("getModePreset", () => {
    it("should return code preset for code mode", () => {
      const preset = getModePreset("code");

      expect(preset).toEqual({
        skipTests: false,
        skipLint: false,
        skipBuild: false,
        skipTypecheck: false,
        skipReview: false,
        skipSimplify: false,
        skipFinalValidation: false,
        maxPhases: 10,
        planHint: "",
      });
    });

    it("should return content preset for content mode", () => {
      const preset = getModePreset("content");

      expect(preset).toEqual({
        skipTests: true,
        skipLint: true,
        skipBuild: true,
        skipTypecheck: true,
        skipReview: true,
        skipSimplify: true,
        skipFinalValidation: true,
        maxPhases: 1,
        planHint: "이 이슈는 코드가 아닌 콘텐츠(문서, 블로그 등) 작업입니다. Phase를 1개로 구성하고 파일 생성/수정에 집중하세요.",
      });
    });
  });

  describe("detectModeFromLabels", () => {
    it("should detect content mode from aq-mode:content label", () => {
      const labels = ["bug", "aq-mode:content", "priority:high"];
      const mode = detectModeFromLabels(labels);

      expect(mode).toBe("content");
    });

    it("should detect code mode from aq-mode:code label", () => {
      const labels = ["feature", "aq-mode:code"];
      const mode = detectModeFromLabels(labels);

      expect(mode).toBe("code");
    });

    it("should return default mode when no aq-mode label found", () => {
      const labels = ["bug", "priority:high"];
      const mode = detectModeFromLabels(labels);

      expect(mode).toBe("code");
    });

    it("should return custom default mode when specified", () => {
      const labels = ["bug", "priority:high"];
      const mode = detectModeFromLabels(labels, "content");

      expect(mode).toBe("content");
    });

    it("should ignore invalid aq-mode labels", () => {
      const labels = ["aq-mode:invalid", "aq-mode:test"];
      const mode = detectModeFromLabels(labels);

      expect(mode).toBe("code");
    });

    it("should take first valid aq-mode label when multiple present", () => {
      const labels = ["aq-mode:content", "aq-mode:code"];
      const mode = detectModeFromLabels(labels);

      expect(mode).toBe("content");
    });

    it("should handle empty labels array", () => {
      const mode = detectModeFromLabels([]);

      expect(mode).toBe("code");
    });
  });

  describe("getExecutionModePreset", () => {
    it("should return economy preset for economy mode", () => {
      const preset = getExecutionModePreset("economy");

      expect(preset).toEqual({
        reviewRounds: 0,
        enableAdvancedReview: false,
        enableSimplify: false,
        enableFinalValidation: false,
        maxPhases: 5,
        maxRetries: 1,
        strictSafety: false,
        description: "빠른 구현에 집중. 리뷰 스킵으로 토큰 소비 최소화"
      });
    });

    it("should return standard preset for standard mode", () => {
      const preset = getExecutionModePreset("standard");

      expect(preset).toEqual({
        reviewRounds: 1,
        enableAdvancedReview: true,
        enableSimplify: true,
        enableFinalValidation: true,
        maxPhases: 10,
        maxRetries: 2,
        strictSafety: true,
        description: "균형 잡힌 품질과 효율성. 1라운드 리뷰로 기본적인 품질 보장"
      });
    });

    it("should return thorough preset for thorough mode", () => {
      const preset = getExecutionModePreset("thorough");

      expect(preset).toEqual({
        reviewRounds: 3,
        enableAdvancedReview: true,
        enableSimplify: true,
        enableFinalValidation: true,
        maxPhases: 15,
        maxRetries: 3,
        strictSafety: true,
        description: "최고 수준의 코드 품질 보장. 보안 및 아키텍처 변경에 적합"
      });
    });
  });

  describe("detectExecutionModeFromLabels", () => {
    describe("new format labels (aqm-*)", () => {
      it("should detect economy mode from aqm-economy label", () => {
        const labels = ["bug", "aqm-economy", "priority:high"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("economy");
      });

      it("should detect thorough mode from aqm-thorough label", () => {
        const labels = ["security", "aqm-thorough"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("thorough");
      });
    });

    describe("legacy format labels (aq-exec:*)", () => {
      it("should detect economy mode from aq-exec:economy label", () => {
        const labels = ["bug", "aq-exec:economy"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("economy");
      });

      it("should detect standard mode from aq-exec:standard label", () => {
        const labels = ["feature", "aq-exec:standard"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("standard");
      });

      it("should detect thorough mode from aq-exec:thorough label", () => {
        const labels = ["security", "aq-exec:thorough"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("thorough");
      });
    });

    describe("default behavior", () => {
      it("should return default standard mode when no execution mode label found", () => {
        const labels = ["bug", "priority:high"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("standard");
      });

      it("should return custom default mode when specified", () => {
        const labels = ["bug", "priority:high"];
        const mode = detectExecutionModeFromLabels(labels, "economy");

        expect(mode).toBe("economy");
      });

      it("should handle empty labels array", () => {
        const mode = detectExecutionModeFromLabels([]);

        expect(mode).toBe("standard");
      });
    });

    describe("label precedence and edge cases", () => {
      it("should prefer new format over legacy format", () => {
        const labels = ["aqm-economy", "aq-exec:thorough"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("economy");
      });

      it("should take first matching label when multiple present", () => {
        const labels = ["aqm-economy", "aqm-thorough"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("economy");
      });

      it("should ignore invalid aq-exec labels", () => {
        const labels = ["aq-exec:invalid", "aq-exec:fast"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("standard");
      });

      it("should ignore partial matches", () => {
        const labels = ["aqm-economy-test", "exec:economy"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("standard");
      });

      it("should handle mixed case sensitivity", () => {
        const labels = ["AQM-ECONOMY", "aq-exec:ECONOMY"];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("standard"); // Should not match due to case sensitivity
      });
    });

    describe("comprehensive label combinations", () => {
      it("should work with complex real-world label sets", () => {
        const labels = [
          "bug",
          "priority:critical",
          "component:security",
          "aqm-thorough",
          "needs-review",
          "backend"
        ];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("thorough");
      });

      it("should handle documentation labels correctly", () => {
        const labels = [
          "documentation",
          "aq-mode:content",
          "aqm-economy",
          "good first issue"
        ];
        const mode = detectExecutionModeFromLabels(labels);

        expect(mode).toBe("economy");
      });
    });
  });
});