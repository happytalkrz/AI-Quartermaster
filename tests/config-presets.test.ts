/**
 * config/presets.ts 단위 테스트
 *
 * 커버리지:
 *  1. 각 프리셋이 올바른 필드를 포함하는지
 *  2. getPresetByName으로 정확한 프리셋 반환
 *  3. 존재하지 않는 프리셋 이름에 대한 undefined 처리
 *  4. 프리셋 fields 키가 BASIC_FIELD_METAS 키 범위 내인지 교차 검증
 *  5. 프리셋 값이 validator 통과하는지 확인
 */
import { describe, it, expect } from "vitest";
import { getPresets, getPresetByName } from "../src/config/presets.js";
import { BASIC_FIELD_METAS } from "../src/config/schema-meta.js";

const PRESET_NAMES = ["economy", "standard", "thorough", "team", "solo"] as const;

describe("getPresets()", () => {
  it("5개 프리셋을 반환한다", () => {
    expect(getPresets()).toHaveLength(5);
  });

  it("economy, standard, thorough, team, solo 순서로 반환한다", () => {
    const names = getPresets().map((p) => p.name);
    expect(names).toEqual([...PRESET_NAMES]);
  });

  it("각 프리셋이 name, label, description, fields 필드를 가진다", () => {
    for (const preset of getPresets()) {
      expect(typeof preset.name).toBe("string");
      expect(preset.name.length).toBeGreaterThan(0);
      expect(typeof preset.label).toBe("string");
      expect(preset.label.length).toBeGreaterThan(0);
      expect(typeof preset.description).toBe("string");
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.fields).toBeDefined();
      expect(typeof preset.fields).toBe("object");
    }
  });
});

describe("getPresetByName()", () => {
  it.each(PRESET_NAMES)("'%s' 프리셋을 정확히 반환한다", (name) => {
    const preset = getPresetByName(name);
    expect(preset).toBeDefined();
    expect(preset!.name).toBe(name);
  });

  it("존재하지 않는 이름에 대해 undefined를 반환한다", () => {
    expect(getPresetByName("nonexistent")).toBeUndefined();
    expect(getPresetByName("ultra")).toBeUndefined();
  });

  it("빈 문자열에 대해 undefined를 반환한다", () => {
    expect(getPresetByName("")).toBeUndefined();
  });
});

describe("fields 키 범위 교차 검증", () => {
  it("모든 프리셋의 fields 키가 BASIC_FIELD_METAS 키 범위 내이다", () => {
    const validKeys = new Set(BASIC_FIELD_METAS.map((m) => m.key));
    for (const preset of getPresets()) {
      for (const key of Object.keys(preset.fields)) {
        expect(
          validKeys.has(key),
          `프리셋 "${preset.name}"의 키 "${key}"가 BASIC_FIELD_METAS에 없습니다`
        ).toBe(true);
      }
    }
  });
});

describe("fields 값 유효성 검증", () => {
  it("executionMode 값은 economy | standard | thorough 중 하나이다", () => {
    const validModes = new Set(["economy", "standard", "thorough"]);
    for (const preset of getPresets()) {
      const mode = preset.fields["executionMode"];
      if (mode !== undefined) {
        expect(
          validModes.has(mode as string),
          `프리셋 "${preset.name}"의 executionMode "${String(mode)}"는 유효하지 않습니다`
        ).toBe(true);
      }
    }
  });

  it("general.concurrency는 min:1 이상이다", () => {
    for (const preset of getPresets()) {
      const val = preset.fields["general.concurrency"];
      if (val !== undefined) {
        expect(
          val as number,
          `프리셋 "${preset.name}"의 concurrency가 1 미만입니다`
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("general.pollingIntervalMs는 min:10000 이상이다", () => {
    for (const preset of getPresets()) {
      const val = preset.fields["general.pollingIntervalMs"];
      if (val !== undefined) {
        expect(
          val as number,
          `프리셋 "${preset.name}"의 pollingIntervalMs가 10000 미만입니다`
        ).toBeGreaterThanOrEqual(10000);
      }
    }
  });

  it("commands.claudeCli.timeout은 min:60000 이상이다", () => {
    for (const preset of getPresets()) {
      const val = preset.fields["commands.claudeCli.timeout"];
      if (val !== undefined) {
        expect(
          val as number,
          `프리셋 "${preset.name}"의 claudeCli.timeout이 60000 미만입니다`
        ).toBeGreaterThanOrEqual(60000);
      }
    }
  });
});

describe("개별 프리셋 필드 검증", () => {
  it("economy: concurrency=5, timeout=300000, maxTurns=50, executionMode=economy", () => {
    const preset = getPresetByName("economy")!;
    expect(preset.fields["general.concurrency"]).toBe(5);
    expect(preset.fields["commands.claudeCli.timeout"]).toBe(300000);
    expect(preset.fields["commands.claudeCli.maxTurns"]).toBe(50);
    expect(preset.fields["executionMode"]).toBe("economy");
  });

  it("standard: concurrency=3, timeout=600000, maxTurns=100, executionMode=standard", () => {
    const preset = getPresetByName("standard")!;
    expect(preset.fields["general.concurrency"]).toBe(3);
    expect(preset.fields["commands.claudeCli.timeout"]).toBe(600000);
    expect(preset.fields["commands.claudeCli.maxTurns"]).toBe(100);
    expect(preset.fields["executionMode"]).toBe("standard");
  });

  it("thorough: concurrency=1, timeout=1200000, executionMode=thorough", () => {
    const preset = getPresetByName("thorough")!;
    expect(preset.fields["general.concurrency"]).toBe(1);
    expect(preset.fields["commands.claudeCli.timeout"]).toBe(1200000);
    expect(preset.fields["executionMode"]).toBe("thorough");
  });

  it("team: concurrency=5, pollingIntervalMs=30000, executionMode=standard", () => {
    const preset = getPresetByName("team")!;
    expect(preset.fields["general.concurrency"]).toBe(5);
    expect(preset.fields["general.pollingIntervalMs"]).toBe(30000);
    expect(preset.fields["executionMode"]).toBe("standard");
  });

  it("solo: concurrency=1, pollingIntervalMs=120000, executionMode=standard", () => {
    const preset = getPresetByName("solo")!;
    expect(preset.fields["general.concurrency"]).toBe(1);
    expect(preset.fields["general.pollingIntervalMs"]).toBe(120000);
    expect(preset.fields["executionMode"]).toBe("standard");
  });
});
