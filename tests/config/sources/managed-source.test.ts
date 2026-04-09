import { describe, it, expect } from "vitest";
import { ManagedSource } from "../../../src/config/sources/managed-source.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";

describe("ManagedSource", () => {
  const source = new ManagedSource();
  const context = { projectRoot: "/tmp/test" };

  it("name이 'managed'이어야 한다", () => {
    expect(source.name).toBe("managed");
  });

  it("DEFAULT_CONFIG를 그대로 반환한다", () => {
    const result = source.load(context);
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it("null을 반환하지 않는다", () => {
    const result = source.load(context);
    expect(result).not.toBeNull();
  });

  it("동기적으로 결과를 반환한다 (Promise 아님)", () => {
    const result = source.load(context);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("general.logLevel 기본값이 info이다", () => {
    const result = source.load(context) as Record<string, unknown>;
    const general = result["general"] as Record<string, unknown>;
    expect(general["logLevel"]).toBe("info");
  });

  it("매 호출마다 동일한 값을 반환한다", () => {
    const r1 = source.load(context);
    const r2 = source.load(context);
    expect(r1).toEqual(r2);
  });
});
