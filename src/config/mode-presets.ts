import type { PipelineMode, ExecutionMode, ExecutionModePreset } from "../types/config.js";

export interface ModePreset {
  skipTests: boolean;
  skipLint: boolean;
  skipBuild: boolean;
  skipTypecheck: boolean;
  skipReview: boolean;
  skipSimplify: boolean;
  skipFinalValidation: boolean;
  maxPhases: number;  // hint for plan generation
  planHint: string;   // extra instruction appended to plan prompt
}

const CODE_PRESET: ModePreset = {
  skipTests: false,
  skipLint: false,
  skipBuild: false,
  skipTypecheck: false,
  skipReview: false,
  skipSimplify: false,
  skipFinalValidation: false,
  maxPhases: 10,
  planHint: "",
};

const CONTENT_PRESET: ModePreset = {
  skipTests: true,
  skipLint: true,
  skipBuild: true,
  skipTypecheck: true,
  skipReview: true,
  skipSimplify: true,
  skipFinalValidation: true,
  maxPhases: 1,
  planHint: "이 이슈는 코드가 아닌 콘텐츠(문서, 블로그 등) 작업입니다. Phase를 1개로 구성하고 파일 생성/수정에 집중하세요.",
};

const PRESETS: Record<PipelineMode, ModePreset> = {
  code: CODE_PRESET,
  content: CONTENT_PRESET,
};

export function getModePreset(mode: PipelineMode): ModePreset {
  return PRESETS[mode];
}

/**
 * Detect mode from issue labels. Labels like "aq-mode:content" override project config.
 */
export function detectModeFromLabels(labels: string[], defaultMode: PipelineMode = "code"): PipelineMode {
  for (const label of labels) {
    const match = label.match(/^aq-mode:(\w+)$/);
    if (match && (match[1] === "code" || match[1] === "content")) {
      return match[1] as PipelineMode;
    }
  }
  return defaultMode;
}

// ExecutionMode Presets

const ECONOMY_PRESET: ExecutionModePreset = {
  reviewRounds: 0,
  enableAdvancedReview: false,
  enableSimplify: false,
  enableFinalValidation: false,
  maxPhases: 5,
  maxRetries: 1,
  strictSafety: false,
  description: "빠른 구현에 집중. 리뷰 스킵으로 토큰 소비 최소화"
};

const STANDARD_PRESET: ExecutionModePreset = {
  reviewRounds: 1,
  enableAdvancedReview: true,
  enableSimplify: true,
  enableFinalValidation: true,
  maxPhases: 10,
  maxRetries: 2,
  strictSafety: true,
  description: "균형 잡힌 품질과 효율성. 1라운드 리뷰로 기본적인 품질 보장"
};

const THOROUGH_PRESET: ExecutionModePreset = {
  reviewRounds: 3,
  enableAdvancedReview: true,
  enableSimplify: true,
  enableFinalValidation: true,
  maxPhases: 15,
  maxRetries: 3,
  strictSafety: true,
  description: "최고 수준의 코드 품질 보장. 보안 및 아키텍처 변경에 적합"
};

const EXECUTION_PRESETS: Record<ExecutionMode, ExecutionModePreset> = {
  economy: ECONOMY_PRESET,
  standard: STANDARD_PRESET,
  thorough: THOROUGH_PRESET,
};

export function getExecutionModePreset(mode: ExecutionMode): ExecutionModePreset {
  return EXECUTION_PRESETS[mode];
}

/**
 * Detect execution mode from issue labels.
 * Supports both new format (aqm-economy, aqm-thorough) and legacy format (aq-exec:*).
 */
export function detectExecutionModeFromLabels(labels: string[], defaultMode: ExecutionMode = "standard"): ExecutionMode {
  const modeMap: Record<string, ExecutionMode> = {
    "aqm-economy": "economy",
    "aqm-thorough": "thorough",
  };

  for (const label of labels) {
    // New format: aqm-economy, aqm-thorough
    if (label in modeMap) {
      return modeMap[label];
    }

    // Legacy format: aq-exec:economy, aq-exec:standard, aq-exec:thorough
    const match = label.match(/^aq-exec:(economy|standard|thorough)$/);
    if (match) {
      return match[1] as ExecutionMode;
    }
  }
  return defaultMode;
}
