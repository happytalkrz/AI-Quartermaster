import { describe, it, expect } from "vitest";
import { runPhaseWithTracking } from "../../../src/pipeline/phases/phase-tracker.js";
import { createFixedClock } from "../../../src/utils/clock.js";
import type { PhaseResult } from "../../../src/types/pipeline.js";

describe("runPhaseWithTracking", () => {
  it("runner 성공 시 PhaseTrackingResult를 반환한다", async () => {
    const clock = createFixedClock("2026-04-26T00:00:00.000Z");
    const tracking = await runPhaseWithTracking(
      "review:code",
      async () => ({ success: true, costUsd: 0.5 }),
      undefined,
      clock
    );

    expect(tracking.result.success).toBe(true);
    expect(tracking.startedAt).toBe("2026-04-26T00:00:00.000Z");
    expect(tracking.completedAt).toBe("2026-04-26T00:00:00.000Z");
    expect(tracking.durationMs).toBe(0);
  });

  it("성공한 runner의 PhaseResult를 누적 배열에 push한다", async () => {
    const accumulated: PhaseResult[] = [];
    await runPhaseWithTracking(
      "review:code",
      async () => ({ success: true, costUsd: 1.23 }),
      accumulated,
      createFixedClock("2026-04-26T00:00:00.000Z")
    );

    expect(accumulated).toHaveLength(1);
    expect(accumulated[0]).toMatchObject({
      phaseName: "review:code",
      success: true,
      costUsd: 1.23,
      startedAt: "2026-04-26T00:00:00.000Z",
      completedAt: "2026-04-26T00:00:00.000Z",
    });
  });

  it("실패한 runner의 PhaseResult를 failure로 push한다", async () => {
    const accumulated: PhaseResult[] = [];
    await runPhaseWithTracking(
      "validation:check",
      async () => ({ success: false, error: "boom", costUsd: 0.1 }),
      accumulated,
      createFixedClock("2026-04-26T00:00:00.000Z")
    );

    expect(accumulated).toHaveLength(1);
    expect(accumulated[0]).toMatchObject({
      phaseName: "validation:check",
      success: false,
      error: "boom",
      costUsd: 0.1,
    });
  });

  it("error 미제공 시 기본 메시지를 사용한다", async () => {
    const accumulated: PhaseResult[] = [];
    await runPhaseWithTracking(
      "publish:pr",
      async () => ({ success: false }),
      accumulated,
      createFixedClock("2026-04-26T00:00:00.000Z")
    );

    expect(accumulated[0].error).toBe("publish:pr failed");
  });

  it("accumulated 미주입 시 push하지 않는다", async () => {
    const tracking = await runPhaseWithTracking(
      "review:simplify",
      async () => ({ success: true }),
      undefined,
      createFixedClock("2026-04-26T00:00:00.000Z")
    );
    expect(tracking.result.success).toBe(true);
  });

  it("runner 예외는 그대로 throw된다 (push 없음)", async () => {
    const accumulated: PhaseResult[] = [];
    await expect(
      runPhaseWithTracking(
        "review:code",
        async () => {
          throw new Error("runner crashed");
        },
        accumulated
      )
    ).rejects.toThrow("runner crashed");
    expect(accumulated).toHaveLength(0);
  });

  it("durationMs는 nowMs 진행에 따라 측정된다", async () => {
    let ms = 1000;
    const advancingClock = {
      nowIso: () => new Date(ms).toISOString(),
      nowMs: () => {
        const cur = ms;
        ms += 250;
        return cur;
      },
    };
    const tracking = await runPhaseWithTracking(
      "setup:worktree",
      async () => ({ success: true }),
      undefined,
      advancingClock
    );
    // startMs=1000 → completedMs=1250 → duration 250
    expect(tracking.durationMs).toBe(250);
  });
});
