import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/pipeline/execution/phase-executor.js", () => ({
  executePhase: vi.fn(),
}));

import { selectExecutor } from "../../../src/pipeline/execution/executor-factory.js";

describe("selectExecutor — 팩토리 분기 검증", () => {
  it('selectExecutor("code")가 execute 메서드를 가진 PhaseExecutor를 반환한다', () => {
    const executor = selectExecutor("code");

    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });

  it('selectExecutor("content")가 execute 메서드를 가진 PhaseExecutor를 반환한다', () => {
    const executor = selectExecutor("content");

    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });

  it('selectExecutor(undefined)가 execute 메서드를 가진 PhaseExecutor를 반환한다', () => {
    const executor = selectExecutor(undefined);

    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe("function");
  });

  it('selectExecutor("qa") 호출 시 "not implemented"를 포함한 에러를 throw한다', () => {
    expect(() => selectExecutor("qa")).toThrow(/not implemented/i);
  });
});
