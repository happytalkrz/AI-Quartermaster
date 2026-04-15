import type { AQConfig, ExecutionMode, ModelRouting } from "../types/config.js";
import { CLAUDE_MODELS } from "../claude/model-constants.js";

export type PresetName = "economy" | "standard" | "thorough" | "team" | "solo";

/**
 * ConfigPreset: Basic 탭 대상 필드를 선언적으로 정의하는 프리셋 구조.
 * AQConfig의 플랫 뷰이며 computePresetDiff에서 현재 config와 비교에 사용된다.
 */
export interface ConfigPreset {
  name: PresetName;
  description: string;
  maxConcurrentJobs: number;       // general.concurrency
  reviewEnabled: boolean;          // review.enabled
  reviewRounds: number;            // review.rounds의 개수
  reviewUnifiedMode: boolean;      // review.unifiedMode
  simplifyEnabled: boolean;        // review.simplify.enabled
  executionMode: ExecutionMode;    // executionMode
  claudeTimeout: number;           // commands.claudeCli.timeout (ms)
  models: ModelRouting;            // commands.claudeCli.models
}

export interface PresetDiffEntry {
  field: string;
  label: string;
  currentValue: unknown;
  presetValue: unknown;
}

export type PresetDiff = PresetDiffEntry[];

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const ECONOMY_PRESET: ConfigPreset = {
  name: "economy",
  description: "빠른 구현에 집중. 리뷰 스킵으로 토큰 소비 최소화",
  maxConcurrentJobs: 1,
  reviewEnabled: false,
  reviewRounds: 0,
  reviewUnifiedMode: false,
  simplifyEnabled: false,
  executionMode: "economy",
  claudeTimeout: 300000,
  models: {
    plan: CLAUDE_MODELS.SONNET,
    phase: CLAUDE_MODELS.SONNET,
    review: CLAUDE_MODELS.HAIKU,
    fallback: CLAUDE_MODELS.HAIKU,
  },
};

const STANDARD_PRESET: ConfigPreset = {
  name: "standard",
  description: "균형 잡힌 품질과 효율성. 1라운드 리뷰로 기본적인 품질 보장",
  maxConcurrentJobs: 1,
  reviewEnabled: true,
  reviewRounds: 1,
  reviewUnifiedMode: false,
  simplifyEnabled: true,
  executionMode: "standard",
  claudeTimeout: 600000,
  models: {
    plan: CLAUDE_MODELS.OPUS,
    phase: CLAUDE_MODELS.SONNET,
    review: CLAUDE_MODELS.HAIKU,
    fallback: CLAUDE_MODELS.SONNET,
  },
};

const THOROUGH_PRESET: ConfigPreset = {
  name: "thorough",
  description: "최고 수준의 코드 품질 보장. 보안 및 아키텍처 변경에 적합",
  maxConcurrentJobs: 1,
  reviewEnabled: true,
  reviewRounds: 3,
  reviewUnifiedMode: true,
  simplifyEnabled: true,
  executionMode: "thorough",
  claudeTimeout: 900000,
  models: {
    plan: CLAUDE_MODELS.OPUS,
    phase: CLAUDE_MODELS.OPUS,
    review: CLAUDE_MODELS.SONNET,
    fallback: CLAUDE_MODELS.SONNET,
  },
};

const TEAM_PRESET: ConfigPreset = {
  name: "team",
  description: "팀 운영에 최적화. 병렬 처리로 여러 이슈를 동시에 처리",
  maxConcurrentJobs: 3,
  reviewEnabled: true,
  reviewRounds: 1,
  reviewUnifiedMode: false,
  simplifyEnabled: true,
  executionMode: "standard",
  claudeTimeout: 600000,
  models: {
    plan: CLAUDE_MODELS.OPUS,
    phase: CLAUDE_MODELS.SONNET,
    review: CLAUDE_MODELS.HAIKU,
    fallback: CLAUDE_MODELS.SONNET,
  },
};

const SOLO_PRESET: ConfigPreset = {
  name: "solo",
  description: "개인 개발자에 최적화. 단일 작업에 집중하며 빠른 피드백 루프",
  maxConcurrentJobs: 1,
  reviewEnabled: true,
  reviewRounds: 1,
  reviewUnifiedMode: false,
  simplifyEnabled: false,
  executionMode: "economy",
  claudeTimeout: 300000,
  models: {
    plan: CLAUDE_MODELS.SONNET,
    phase: CLAUDE_MODELS.SONNET,
    review: CLAUDE_MODELS.HAIKU,
    fallback: CLAUDE_MODELS.HAIKU,
  },
};

const PRESETS: Record<PresetName, ConfigPreset> = {
  economy: ECONOMY_PRESET,
  standard: STANDARD_PRESET,
  thorough: THOROUGH_PRESET,
  team: TEAM_PRESET,
  solo: SOLO_PRESET,
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function getPreset(name: PresetName): ConfigPreset {
  return PRESETS[name];
}

export function listPresets(): ConfigPreset[] {
  return Object.values(PRESETS);
}

/**
 * AQConfig에서 ConfigPreset 비교 대상 필드를 추출한다.
 * review.rounds 개수는 실제 배열 길이로 계산한다.
 */
function extractPresetFields(config: AQConfig): Omit<ConfigPreset, "name" | "description"> {
  return {
    maxConcurrentJobs: config.general.concurrency,
    reviewEnabled: config.review.enabled,
    reviewRounds: config.review.rounds.length,
    reviewUnifiedMode: config.review.unifiedMode ?? false,
    simplifyEnabled: config.review.simplify.enabled,
    executionMode: config.executionMode,
    claudeTimeout: config.commands.claudeCli.timeout,
    models: { ...config.commands.claudeCli.models },
  };
}

const FIELD_LABELS: Record<keyof Omit<ConfigPreset, "name" | "description">, string> = {
  maxConcurrentJobs: "동시 작업 수",
  reviewEnabled: "리뷰 활성화",
  reviewRounds: "리뷰 라운드",
  reviewUnifiedMode: "통합 리뷰 모드",
  simplifyEnabled: "코드 간소화",
  executionMode: "실행 모드",
  claudeTimeout: "Claude 타임아웃(ms)",
  models: "모델 라우팅",
};

/**
 * 현재 config 대비 프리셋이 변경하는 필드 목록을 반환한다.
 * 변경이 없는 필드는 포함하지 않는다.
 */
export function computePresetDiff(currentConfig: AQConfig, presetName: PresetName): PresetDiff {
  const preset = getPreset(presetName);
  const current = extractPresetFields(currentConfig);
  const diff: PresetDiff = [];

  const fields = Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[];
  for (const field of fields) {
    const currentVal = current[field];
    const presetVal = preset[field];

    if (!isDeepEqual(currentVal, presetVal)) {
      diff.push({
        field,
        label: FIELD_LABELS[field],
        currentValue: currentVal,
        presetValue: presetVal,
      });
    }
  }

  return diff;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!isDeepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    )) {
      return false;
    }
  }
  return true;
}
