import type { PipelineMode } from "../types/config.js";

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
