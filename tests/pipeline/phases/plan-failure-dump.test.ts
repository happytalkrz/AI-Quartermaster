import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dumpPlanFailure, computeCharStats } from "../../../src/pipeline/phases/plan-failure-dump.js";

describe("computeCharStats", () => {
  it("백틱/화살표/curly quote/control char 카운트", () => {
    const text = "Hello `world` → 한글 “quote” \x07 ascii";
    const stats = computeCharStats(text);

    expect(stats.backticks).toBe(2);
    expect(stats.arrowRight).toBe(1);
    expect(stats.curlyQuotes).toBe(2);
    expect(stats.controlChars).toBe(1);
    expect(stats.nonAscii).toBeGreaterThan(0);
  });

  it("줄바꿈/탭은 controlChars에 포함하지 않는다", () => {
    expect(computeCharStats("a\nb\tc\rd").controlChars).toBe(0);
  });

  it("ASCII 전용 문자열은 nonAscii=0", () => {
    expect(computeCharStats("plain text").nonAscii).toBe(0);
  });
});

describe("dumpPlanFailure", () => {
  let aqmHome: string;

  beforeEach(() => {
    aqmHome = mkdtempSync(join(tmpdir(), "plan-fail-test-"));
  });

  afterEach(() => {
    rmSync(aqmHome, { recursive: true, force: true });
  });

  it("raw .txt + meta .json + index.jsonl 3개를 생성한다", () => {
    const fixedNow = new Date("2026-04-29T12:00:00.000Z");
    const record = dumpPlanFailure({
      aqmHome,
      issueNumber: 791,
      attempt: 2,
      errorCategory: "UNKNOWN",
      errorMessage: "Unexpected token in JSON at position 1234",
      rawResponse: "raw `claude` output → 한글 with \x07 ctrl",
      now: fixedNow,
    });

    expect(record).toBeDefined();
    const logsDir = join(aqmHome, "logs");
    const files = readdirSync(logsDir).sort();

    expect(files).toContain("plan-failures-index.jsonl");
    expect(files.some(f => f.startsWith("plan-fail-791-") && f.endsWith(".txt"))).toBe(true);
    expect(files.some(f => f.startsWith("plan-fail-791-") && f.endsWith(".json"))).toBe(true);

    // raw 응답 보존
    const txt = readFileSync(record!.rawDumpFile, "utf-8");
    expect(txt).toBe("raw `claude` output → 한글 with \x07 ctrl");

    // 메타 JSON 구조
    const metaPath = record!.rawDumpFile.replace(/\.txt$/, ".json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.issueNumber).toBe(791);
    expect(meta.attempt).toBe(2);
    expect(meta.errorCategory).toBe("UNKNOWN");
    expect(meta.charStats.backticks).toBe(2);
    expect(meta.charStats.arrowRight).toBe(1);
    expect(meta.charStats.controlChars).toBe(1);
  });

  it("같은 이슈 재실패 시 인덱스에 라인이 누적된다", () => {
    dumpPlanFailure({
      aqmHome, issueNumber: 791, attempt: 1, errorCategory: "UNKNOWN",
      errorMessage: "fail-1", rawResponse: "first",
      now: new Date("2026-04-29T12:00:00.000Z"),
    });
    dumpPlanFailure({
      aqmHome, issueNumber: 791, attempt: 2, errorCategory: "UNKNOWN",
      errorMessage: "fail-2", rawResponse: "second",
      now: new Date("2026-04-29T12:00:01.000Z"),
    });

    const indexPath = join(aqmHome, "logs", "plan-failures-index.jsonl");
    const lines = readFileSync(indexPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.attempt).toBe(1);
    expect(second.attempt).toBe(2);
    expect(first.errorMessage).toBe("fail-1");
    expect(second.errorMessage).toBe("fail-2");
  });

  it("aqmHome가 존재하지 않으면 자동 생성한다", () => {
    const nestedHome = join(aqmHome, "deep", "nested");
    expect(existsSync(nestedHome)).toBe(false);

    const record = dumpPlanFailure({
      aqmHome: nestedHome,
      issueNumber: 1,
      attempt: 1,
      errorCategory: "UNKNOWN",
      errorMessage: "x",
      rawResponse: "y",
    });

    expect(record).toBeDefined();
    expect(existsSync(join(nestedHome, "logs"))).toBe(true);
  });

  it("IO 실패 시에도 throw하지 않고 undefined 반환", () => {
    // aqmHome 경로에 일반 파일을 두면 그 하위 mkdir이 ENOTDIR로 실패한다
    const fakeHome = join(aqmHome, "fake");
    writeFileSync(fakeHome, "this-is-a-file-not-a-dir", "utf-8");

    const result = dumpPlanFailure({
      aqmHome: fakeHome,
      issueNumber: 1,
      attempt: 1,
      errorCategory: "UNKNOWN",
      errorMessage: "x",
      rawResponse: "y",
    });
    expect(result).toBeUndefined();
  });
});
