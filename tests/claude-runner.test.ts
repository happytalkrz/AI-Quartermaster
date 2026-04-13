import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../src/utils/rate-limiter.js", () => ({
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock("../src/pipeline/errors/error-classifier.js", () => ({
  classifyError: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/claude/token-pricing.js", () => ({
  calculateCostFromUsage: vi.fn().mockReturnValue(0),
}));

import {
  killAllActiveProcesses,
  isClaudeProcessAlive,
  getActiveProcessPids,
} from "../src/claude/claude-runner.js";

describe("isClaudeProcessAlive", () => {
  it("활성 프로세스가 없으면 false 반환", () => {
    expect(isClaudeProcessAlive()).toBe(false);
  });
});

describe("getActiveProcessPids", () => {
  it("활성 프로세스가 없으면 빈 배열 반환", () => {
    expect(getActiveProcessPids()).toEqual([]);
  });
});

describe("killAllActiveProcesses", () => {
  it("activeProcesses가 비어있으면 즉시 resolve", async () => {
    await expect(killAllActiveProcesses()).resolves.toBeUndefined();
  });
});
