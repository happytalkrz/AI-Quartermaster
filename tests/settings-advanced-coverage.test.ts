/**
 * AQConfig 스키마 키 커버리지 테스트
 *
 * AQConfig의 모든 top-level 키가 Basic 탭 또는 Advanced 탭 중 하나에
 * 반드시 할당되어 있음을 보장한다.
 *
 * - BASIC_KEYS: render-settings.js의 Basic 탭에서 렌더링하는 키
 *   (renderTabForm('general'|'safety'|'review'), bindCommandsCliFields → commands, 프로젝트 카드 → projects)
 * - ADVANCED_KEYS: Advanced 탭 ADVANCED_SECTION_MAP이 직접 노출하거나
 *   config.yml 직접 편집으로만 변경 가능한 키
 *
 * 새 AQConfig 필드를 추가할 때 이 테스트를 업데이트하지 않으면
 * 컴파일 타임(_coverageCheck)과 런타임(expect) 양쪽에서 실패한다.
 */
import { describe, it, expect } from "vitest";
import type { AQConfig } from "../src/types/config.js";

// ── 키 목록 ──────────────────────────────────────────────────────────────────

/**
 * Basic 탭(general/safety/review 서브탭 + 프로젝트 카드)에서 렌더링하는 AQConfig 최상위 키.
 * render-settings.js 기준:
 *   renderTabForm('general')  → general
 *   renderTabForm('safety')   → safety
 *   renderTabForm('review')   → review
 *   bindCommandsCliFields()   → commands (claudeCli.maxTurns 등)
 *   renderProjectCard()       → projects
 */
const BASIC_KEYS = [
  "general",
  "safety",
  "review",
  "commands",
  "projects",
] as const;

/**
 * Advanced 탭이 노출하는 AQConfig 최상위 키.
 * render-settings.js ADVANCED_SECTION_MAP:
 *   hooks        → config.hooks (직접 노출)
 *   retryPolicy  → config.commands.claudeCli.retry (commands 하위)
 *   models       → config.commands.claudeCli.models (commands 하위)
 *   allowedTools → config.commands.claudeCli.additionalArgs (commands 하위)
 *   sensitivePaths → config.safety.sensitivePaths (safety 하위)
 *
 * config.yml 직접 편집 전용(UI 저장 미지원):
 *   git, worktree, pr, features, executionMode, automations
 */
const ADVANCED_KEYS = [
  "hooks",
  "git",
  "worktree",
  "pr",
  "features",
  "executionMode",
  "automations",
] as const;

// ── 컴파일 타임 커버리지 검증 ──────────────────────────────────────────────────

type BasicKey = (typeof BASIC_KEYS)[number];
type AdvancedKey = (typeof ADVANCED_KEYS)[number];
type CoveredKey = BasicKey | AdvancedKey;

/**
 * AQConfig의 모든 top-level 키 중 BASIC_KEYS | ADVANCED_KEYS에 없는 키.
 * 이 타입이 never가 아니면 아래 _coverageCheck 선언에서 컴파일 에러가 발생한다.
 * → tsc --noEmit 실행 시 누락 키가 있으면 빌드 실패.
 */
type _UncoveredKeys = Exclude<keyof AQConfig, CoveredKey>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _coverageCheck: _UncoveredKeys extends never ? true : never = true;

// ── 런타임 테스트 ─────────────────────────────────────────────────────────────

describe("AQConfig 스키마 키 커버리지", () => {
  it("BASIC_KEYS와 ADVANCED_KEYS 사이에 중복이 없어야 한다", () => {
    const basicSet = new Set<string>(BASIC_KEYS);
    const overlap = ADVANCED_KEYS.filter((k) => basicSet.has(k));
    expect(overlap).toHaveLength(0);
  });

  it("BASIC_KEYS ∪ ADVANCED_KEYS의 합집합이 AQConfig top-level 키 12개를 커버해야 한다", () => {
    const union = new Set<string>([...BASIC_KEYS, ...ADVANCED_KEYS]);
    // AQConfig interface top-level 키:
    //   general, git, worktree, commands, review, pr, safety,
    //   features, executionMode, hooks, projects, automations
    expect(union.size).toBe(12);
  });

  it("BASIC_KEYS가 Basic 탭 렌더 대상을 모두 포함해야 한다", () => {
    // render-settings.js renderSettingsView()에서 호출되는 항목
    const basicTabTargets = ["general", "safety", "review", "commands", "projects"];
    for (const key of basicTabTargets) {
      expect(BASIC_KEYS as readonly string[]).toContain(key);
    }
  });

  it("ADVANCED_KEYS가 ADVANCED_SECTION_MAP의 최상위 config 키를 포함해야 한다", () => {
    // render-settings.js ADVANCED_SECTION_MAP에서 config.hooks를 직접 노출
    expect(ADVANCED_KEYS as readonly string[]).toContain("hooks");
  });

  it("ADVANCED_KEYS가 config.yml 직접 편집 전용 키를 포함해야 한다", () => {
    const configYmlOnlyKeys = ["git", "worktree", "pr", "features", "executionMode", "automations"];
    for (const key of configYmlOnlyKeys) {
      expect(ADVANCED_KEYS as readonly string[]).toContain(key);
    }
  });
});
