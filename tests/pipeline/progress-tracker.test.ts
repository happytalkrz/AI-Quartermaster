import { describe, it, expect } from "vitest";
import {
  PROGRESS_ISSUE_VALIDATED,
  PROGRESS_PLAN_GENERATED,
  PROGRESS_REVIEW_START,
  PROGRESS_SIMPLIFY_START,
  PROGRESS_VALIDATION_START,
  PROGRESS_PR_CREATED,
  PROGRESS_DONE,
  phaseStart,
  phaseProgress,
  progressForState,
} from "../../src/pipeline/progress-tracker.js";

describe("progress-tracker constants", () => {
  it("PROGRESS_ISSUE_VALIDATED should be 5", () => {
    expect(PROGRESS_ISSUE_VALIDATED).toBe(5);
  });

  it("PROGRESS_PLAN_GENERATED should be 15", () => {
    expect(PROGRESS_PLAN_GENERATED).toBe(15);
  });

  it("PROGRESS_REVIEW_START should be 75", () => {
    expect(PROGRESS_REVIEW_START).toBe(75);
  });

  it("PROGRESS_SIMPLIFY_START should be 80", () => {
    expect(PROGRESS_SIMPLIFY_START).toBe(80);
  });

  it("PROGRESS_VALIDATION_START should be 85", () => {
    expect(PROGRESS_VALIDATION_START).toBe(85);
  });

  it("PROGRESS_PR_CREATED should be 95", () => {
    expect(PROGRESS_PR_CREATED).toBe(95);
  });

  it("PROGRESS_DONE should be 100", () => {
    expect(PROGRESS_DONE).toBe(100);
  });
});

describe("phaseStart", () => {
  it("should return PHASE_EXECUTION_START (15) when total <= 0", () => {
    expect(phaseStart(0, 0)).toBe(15);
    expect(phaseStart(1, 0)).toBe(15);
    expect(phaseStart(0, -1)).toBe(15);
  });

  it("should return 15 for index=0 with any positive total", () => {
    expect(phaseStart(0, 4)).toBe(15);
    expect(phaseStart(0, 1)).toBe(15);
    expect(phaseStart(0, 10)).toBe(15);
  });

  it("should return 75 for index=total (end of execution range)", () => {
    // PHASE_EXECUTION_START + (total/total) * PHASE_EXECUTION_RANGE = 15 + 60 = 75
    expect(phaseStart(4, 4)).toBe(75);
    expect(phaseStart(1, 1)).toBe(75);
  });

  it("should calculate correct start for middle phases", () => {
    // total=4: perPhase=15, index=1 -> 15 + (1/4)*60 = 15 + 15 = 30
    expect(phaseStart(1, 4)).toBe(30);
    // index=2 -> 15 + (2/4)*60 = 15 + 30 = 45
    expect(phaseStart(2, 4)).toBe(45);
    // index=3 -> 15 + (3/4)*60 = 15 + 45 = 60
    expect(phaseStart(3, 4)).toBe(60);
  });

  it("should handle total=2 correctly", () => {
    expect(phaseStart(0, 2)).toBe(15);
    expect(phaseStart(1, 2)).toBe(45);
    expect(phaseStart(2, 2)).toBe(75);
  });
});

describe("phaseProgress", () => {
  it("should return PHASE_EXECUTION_START (15) when total <= 0", () => {
    expect(phaseProgress(0, 0, 50)).toBe(15);
    expect(phaseProgress(1, 0, 0)).toBe(15);
    expect(phaseProgress(0, -5, 100)).toBe(15);
  });

  it("should return phaseStart at internalPercent=0", () => {
    // index=0, total=4 -> 15 + 0 + 0 = 15
    expect(phaseProgress(0, 4, 0)).toBe(15);
    // index=1, total=4 -> 15 + 1*(60/4) + 0 = 15 + 15 = 30
    expect(phaseProgress(1, 4, 0)).toBe(30);
  });

  it("should return phaseStart of next phase at internalPercent=100", () => {
    // index=0, total=4, internalPercent=100 -> 15 + 0 + (100/100)*(60/4) = 15 + 15 = 30
    expect(phaseProgress(0, 4, 100)).toBe(30);
    // index=1, total=4, internalPercent=100 -> 15 + 15 + 15 = 45
    expect(phaseProgress(1, 4, 100)).toBe(45);
  });

  it("should calculate midpoint correctly at internalPercent=50", () => {
    // index=0, total=4, internalPercent=50 -> 15 + 0 + (50/100)*(60/4) = 15 + 7.5 = 22.5
    expect(phaseProgress(0, 4, 50)).toBe(22.5);
    // index=2, total=4, internalPercent=50 -> 15 + 30 + 7.5 = 52.5
    expect(phaseProgress(2, 4, 50)).toBe(52.5);
  });

  it("should span full execution range for single phase", () => {
    // total=1: perPhase=60
    expect(phaseProgress(0, 1, 0)).toBe(15);
    expect(phaseProgress(0, 1, 50)).toBe(45);
    expect(phaseProgress(0, 1, 100)).toBe(75);
  });
});

describe("progressForState", () => {
  it("should return 0 for RECEIVED", () => {
    expect(progressForState("RECEIVED")).toBe(0);
  });

  it("should return 5 for VALIDATED", () => {
    expect(progressForState("VALIDATED")).toBe(5);
  });

  it("should return 5 for BASE_SYNCED", () => {
    expect(progressForState("BASE_SYNCED")).toBe(5);
  });

  it("should return 5 for BRANCH_CREATED", () => {
    expect(progressForState("BRANCH_CREATED")).toBe(5);
  });

  it("should return 5 for WORKTREE_CREATED", () => {
    expect(progressForState("WORKTREE_CREATED")).toBe(5);
  });

  it("should return 15 for PLAN_GENERATED", () => {
    expect(progressForState("PLAN_GENERATED")).toBe(15);
  });

  it("should return 75 for REVIEWING", () => {
    expect(progressForState("REVIEWING")).toBe(75);
  });

  it("should return 80 for SIMPLIFYING", () => {
    expect(progressForState("SIMPLIFYING")).toBe(80);
  });

  it("should return 85 for FINAL_VALIDATING", () => {
    expect(progressForState("FINAL_VALIDATING")).toBe(85);
  });

  it("should return 95 for DRAFT_PR_CREATED", () => {
    expect(progressForState("DRAFT_PR_CREATED")).toBe(95);
  });

  it("should return 97 for CI_CHECKING", () => {
    expect(progressForState("CI_CHECKING")).toBe(97);
  });

  it("should return 0 for CI_FIXING", () => {
    expect(progressForState("CI_FIXING")).toBe(0);
  });

  it("should return 100 for DONE", () => {
    expect(progressForState("DONE")).toBe(100);
  });

  it("should return 0 for unknown/default state", () => {
    expect(progressForState("UNKNOWN_STATE")).toBe(0);
    expect(progressForState("")).toBe(0);
    expect(progressForState("executing")).toBe(0);
  });
});
