import { describe, it, expect } from "vitest";
import {
  BASIC_FIELD_METAS,
  getBasicFieldMetas,
  type FieldMeta,
  type FieldType,
} from "../../src/config/schema-meta.js";

describe("BASIC_FIELD_METAS", () => {
  it("화이트리스트 필드가 정확히 11개 포함된다", () => {
    expect(BASIC_FIELD_METAS).toHaveLength(11);
  });

  it("모든 필드에 key, type, label이 존재한다", () => {
    for (const field of BASIC_FIELD_METAS) {
      expect(field.key).toBeTruthy();
      expect(field.type).toBeTruthy();
      expect(field.label).toBeTruthy();
    }
  });

  it("key 값이 모두 고유하다", () => {
    const keys = BASIC_FIELD_METAS.map((f) => f.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("type은 유효한 FieldType 값만 포함한다", () => {
    const validTypes: FieldType[] = ["number", "toggle", "dropdown", "text", "chip-input"];
    for (const field of BASIC_FIELD_METAS) {
      expect(validTypes).toContain(field.type);
    }
  });
});

describe("general 섹션 필드 메타데이터", () => {
  const getField = (key: string): FieldMeta => {
    const field = BASIC_FIELD_METAS.find((f) => f.key === key);
    if (!field) throw new Error(`field not found: ${key}`);
    return field;
  };

  it("general.concurrency — number, min:1, default:1", () => {
    const field = getField("general.concurrency");
    expect(field.type).toBe("number");
    expect(field.default).toBe(1);
    expect(field.min).toBe(1);
    expect(field.max).toBeUndefined();
  });

  it("general.logLevel — dropdown, options 4개, default:info", () => {
    const field = getField("general.logLevel");
    expect(field.type).toBe("dropdown");
    expect(field.default).toBe("info");
    expect(field.options).toEqual(["debug", "info", "warn", "error"]);
  });

  it("general.dryRun — toggle, default:false", () => {
    const field = getField("general.dryRun");
    expect(field.type).toBe("toggle");
    expect(field.default).toBe(false);
  });

  it("general.pollingIntervalMs — number, min:10000, default:60000", () => {
    const field = getField("general.pollingIntervalMs");
    expect(field.type).toBe("number");
    expect(field.default).toBe(60000);
    expect(field.min).toBe(10000);
    expect(field.max).toBeUndefined();
  });

  it("general.maxJobs — number, min:1, default:500", () => {
    const field = getField("general.maxJobs");
    expect(field.type).toBe("number");
    expect(field.default).toBe(500);
    expect(field.min).toBe(1);
    expect(field.max).toBeUndefined();
  });
});

describe("safety 섹션 필드 메타데이터", () => {
  const getField = (key: string): FieldMeta => {
    const field = BASIC_FIELD_METAS.find((f) => f.key === key);
    if (!field) throw new Error(`field not found: ${key}`);
    return field;
  };

  it("safety.maxPhases — number, min:1, max:20, default:10", () => {
    const field = getField("safety.maxPhases");
    expect(field.type).toBe("number");
    expect(field.default).toBe(10);
    expect(field.min).toBe(1);
    expect(field.max).toBe(20);
  });

  it("safety.maxRetries — number, min:1, max:10, default:3", () => {
    const field = getField("safety.maxRetries");
    expect(field.type).toBe("number");
    expect(field.default).toBe(3);
    expect(field.min).toBe(1);
    expect(field.max).toBe(10);
  });

  it("safety.requireTests — toggle, default:false", () => {
    const field = getField("safety.requireTests");
    expect(field.type).toBe("toggle");
    expect(field.default).toBe(false);
  });

  it("safety.maxFileChanges — number, min:1, default:50", () => {
    const field = getField("safety.maxFileChanges");
    expect(field.type).toBe("number");
    expect(field.default).toBe(50);
    expect(field.min).toBe(1);
    expect(field.max).toBeUndefined();
  });
});

describe("review/git 섹션 필드 메타데이터", () => {
  const getField = (key: string): FieldMeta => {
    const field = BASIC_FIELD_METAS.find((f) => f.key === key);
    if (!field) throw new Error(`field not found: ${key}`);
    return field;
  };

  it("review.enabled — toggle, default:true", () => {
    const field = getField("review.enabled");
    expect(field.type).toBe("toggle");
    expect(field.default).toBe(true);
  });

  it("git.defaultBaseBranch — text, default:main", () => {
    const field = getField("git.defaultBaseBranch");
    expect(field.type).toBe("text");
    expect(field.default).toBe("main");
  });
});

describe("getBasicFieldMetas()", () => {
  it("BASIC_FIELD_METAS와 동일한 배열을 반환한다", () => {
    expect(getBasicFieldMetas()).toBe(BASIC_FIELD_METAS);
  });

  it("반환값이 배열이다", () => {
    expect(Array.isArray(getBasicFieldMetas())).toBe(true);
  });

  it("반환값이 비어 있지 않다", () => {
    expect(getBasicFieldMetas().length).toBeGreaterThan(0);
  });
});

describe("number 타입 필드 제약 일관성", () => {
  it("min이 정의된 number 필드는 min이 양수다", () => {
    const numberFields = BASIC_FIELD_METAS.filter((f) => f.type === "number");
    for (const field of numberFields) {
      if (field.min !== undefined) {
        expect(field.min).toBeGreaterThan(0);
      }
    }
  });

  it("max가 정의된 number 필드는 min <= max를 만족한다", () => {
    const numberFields = BASIC_FIELD_METAS.filter((f) => f.type === "number");
    for (const field of numberFields) {
      if (field.min !== undefined && field.max !== undefined) {
        expect(field.min).toBeLessThanOrEqual(field.max);
      }
    }
  });
});

describe("dropdown 타입 필드 제약 일관성", () => {
  it("dropdown 필드는 options 배열이 비어 있지 않다", () => {
    const dropdownFields = BASIC_FIELD_METAS.filter((f) => f.type === "dropdown");
    for (const field of dropdownFields) {
      expect(field.options).toBeDefined();
      expect(field.options!.length).toBeGreaterThan(0);
    }
  });

  it("dropdown 필드의 default는 options 중 하나다", () => {
    const dropdownFields = BASIC_FIELD_METAS.filter((f) => f.type === "dropdown");
    for (const field of dropdownFields) {
      expect(field.options).toContain(field.default);
    }
  });
});
