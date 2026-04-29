import { describe, it, expect } from "vitest";
import {
  escapeRawControlInsideStrings,
  normalizeCurlyQuotes,
  stripTrailingCommas,
  repairPlanJson,
} from "../../../src/pipeline/phases/plan-json-repair.js";

describe("escapeRawControlInsideStrings", () => {
  it("문자열 내부의 raw newline → \\n으로 escape", () => {
    const input = '{"a":"line1\nline2"}';
    const output = escapeRawControlInsideStrings(input);
    expect(output).toBe('{"a":"line1\\nline2"}');
    expect(JSON.parse(output)).toEqual({ a: "line1\nline2" });
  });

  it("문자열 내부의 raw tab → \\t", () => {
    const input = '{"a":"col1\tcol2"}';
    const output = escapeRawControlInsideStrings(input);
    expect(output).toBe('{"a":"col1\\tcol2"}');
  });

  it("문자열 외부의 newline은 그대로 둔다", () => {
    const input = '{\n  "a":"x"\n}';
    expect(escapeRawControlInsideStrings(input)).toBe(input);
  });

  it("이미 escape된 \\n은 손대지 않는다", () => {
    const input = '{"a":"already\\nescaped"}';
    expect(escapeRawControlInsideStrings(input)).toBe(input);
  });

  it("0x00–0x1F의 기타 control char → \\u00XX", () => {
    const input = '{"a":"x\x07y"}'; // BEL
    const output = escapeRawControlInsideStrings(input);
    expect(output).toBe('{"a":"x\\u0007y"}');
    expect(JSON.parse(output)).toEqual({ a: "x\x07y" });
  });
});

describe("normalizeCurlyQuotes", () => {
  it("U+201C/D → 일반 큰따옴표", () => {
    expect(normalizeCurlyQuotes("“hello” “world”")).toBe('"hello" "world"');
  });
  it("U+2018/9 → 일반 작은따옴표", () => {
    expect(normalizeCurlyQuotes("‘x’ ‘y’")).toBe("'x' 'y'");
  });
});

describe("stripTrailingCommas", () => {
  it("객체 마지막 멤버 뒤 trailing comma 제거", () => {
    expect(stripTrailingCommas('{"a":1,"b":2,}')).toBe('{"a":1,"b":2}');
  });
  it("배열 마지막 원소 뒤 trailing comma 제거", () => {
    expect(stripTrailingCommas("[1,2,3,]")).toBe("[1,2,3]");
  });
  it("줄바꿈을 사이에 둔 trailing comma도 제거", () => {
    expect(stripTrailingCommas('{"a":1,\n}')).toBe('{"a":1\n}');
  });
  it("문자열 내부의 콤마는 건드리지 않는다", () => {
    const input = '{"a":"x,y,"}';
    expect(stripTrailingCommas(input)).toBe(input);
  });
  it("정상 콤마는 보존", () => {
    expect(stripTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
  });
});

describe("repairPlanJson 통합", () => {
  it("escape 누락 + trailing comma 동시 복구로 JSON.parse 성공", () => {
    const broken = '{\n  "problemDefinition":"긴 한글\n다음 줄",\n  "extra":"x",\n}';
    const repaired = repairPlanJson(broken);
    const obj = JSON.parse(repaired) as { problemDefinition: string; extra: string };
    expect(obj.problemDefinition).toBe("긴 한글\n다음 줄");
    expect(obj.extra).toBe("x");
  });

  it("이미 valid한 JSON은 변경 없이 통과", () => {
    const valid = '{"a":"plain","b":1}';
    expect(repairPlanJson(valid)).toBe(valid);
    expect(JSON.parse(repairPlanJson(valid))).toEqual({ a: "plain", b: 1 });
  });

  it("백틱 + 화살표 (→)는 JSON에서 합법 — 그대로 보존", () => {
    const input = '{"text":"`code` → arrow"}';
    expect(repairPlanJson(input)).toBe(input);
  });
});
