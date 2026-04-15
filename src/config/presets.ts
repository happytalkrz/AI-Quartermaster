/**
 * 설정 페이지 프리셋 정의
 *
 * Basic 탭 필드(BASIC_FIELD_METAS 키 기준)만 덮어쓸 수 있는 5개 프리셋을 선언적으로 정의한다.
 */

import { BASIC_FIELD_METAS } from "./schema-meta.js";

/** Basic 탭 필드 키 유니온 타입 */
export type BasicFieldKey = (typeof BASIC_FIELD_METAS)[number]["key"];

/** 프리셋이 덮어쓸 수 있는 필드는 BASIC_FIELD_METAS 키로 제한한다 */
export interface ConfigPreset {
  name: string;
  label: string;
  description: string;
  fields: Partial<Record<BasicFieldKey, unknown>>;
}

const PRESETS: ConfigPreset[] = [
  {
    name: "economy",
    label: "Economy",
    description: "빠른 처리 최우선. 동시 실행 수를 높이고 타임아웃을 줄여 속도를 높인다.",
    fields: {
      "general.concurrency": 5,
      "general.pollingIntervalMs": 30000,
      "commands.claudeCli.timeout": 300000,
      "commands.claudeCli.maxTurns": 50,
      "executionMode": "economy",
    },
  },
  {
    name: "standard",
    label: "Standard",
    description: "균형 잡힌 기본 설정. 대부분의 프로젝트에 적합하다.",
    fields: {
      "general.concurrency": 3,
      "general.pollingIntervalMs": 60000,
      "commands.claudeCli.timeout": 600000,
      "commands.claudeCli.maxTurns": 100,
      "executionMode": "standard",
    },
  },
  {
    name: "thorough",
    label: "Thorough",
    description: "꼼꼼한 처리 우선. 타임아웃을 늘리고 단일 실행으로 품질을 높인다.",
    fields: {
      "general.concurrency": 1,
      "general.pollingIntervalMs": 60000,
      "commands.claudeCli.timeout": 1200000,
      "commands.claudeCli.maxTurns": 180,
      "executionMode": "thorough",
    },
  },
  {
    name: "team",
    label: "Team",
    description: "팀 환경용. 동시 실행 수를 높여 여러 이슈를 병렬 처리한다.",
    fields: {
      "general.concurrency": 5,
      "general.pollingIntervalMs": 30000,
      "commands.claudeCli.timeout": 600000,
      "commands.claudeCli.maxTurns": 100,
      "executionMode": "standard",
    },
  },
  {
    name: "solo",
    label: "Solo",
    description: "개인 프로젝트용. 단일 실행으로 리소스 사용을 최소화한다.",
    fields: {
      "general.concurrency": 1,
      "general.pollingIntervalMs": 120000,
      "commands.claudeCli.timeout": 600000,
      "commands.claudeCli.maxTurns": 100,
      "executionMode": "standard",
    },
  },
];

/**
 * 모든 프리셋 목록을 반환한다.
 */
export function getPresets(): ConfigPreset[] {
  return PRESETS;
}

/**
 * 이름으로 특정 프리셋을 반환한다. 없으면 undefined.
 */
export function getPresetByName(name: string): ConfigPreset | undefined {
  return PRESETS.find((p) => p.name === name);
}
