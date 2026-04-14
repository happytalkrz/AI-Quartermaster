import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock은 호이스팅되므로 mockLogger도 vi.hoisted()로 호이스팅해야 함
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { initDispatcher, dispatchPipelineEvent } from "../../src/pipeline/automation/automation-dispatcher.js";
import { AutomationScheduler } from "../../src/automation/scheduler.js";
import type {
  PipelineEvent,
  PrMergedPayload,
  DraftPrCreatedPayload,
  PhaseFailedPayload,
  PipelineCompletePayload,
  PipelineFailedPayload,
} from "../../src/types/pipeline.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

function makeScheduler(running: boolean): AutomationScheduler {
  const mockHandlers = {
    addLabel: vi.fn().mockResolvedValue(undefined),
    startJob: vi.fn().mockResolvedValue(undefined),
    pauseProject: vi.fn().mockResolvedValue(undefined)
  };

  const scheduler = new AutomationScheduler(DEFAULT_CONFIG, [], mockHandlers);
  if (running) scheduler.start();
  return scheduler;
}

function makeDraftPrCreatedEvent(): PipelineEvent<"draft-pr-created"> {
  return {
    type: "draft-pr-created",
    payload: {
      issueNumber: 42,
      repo: "test/repo",
      prNumber: 7,
      prUrl: "https://github.com/test/repo/pull/7",
      branchName: "aq/42-test-feature",
      createdAt: "2026-04-10T11:00:00Z",
    } satisfies DraftPrCreatedPayload,
    triggeredAt: "2026-04-10T11:00:00Z",
  };
}

function makePrMergedEvent(): PipelineEvent<"pr-merged"> {
  return {
    type: "pr-merged",
    payload: {
      issueNumber: 42,
      repo: "test/repo",
      prNumber: 7,
      prUrl: "https://github.com/test/repo/pull/7",
      mergedAt: "2026-04-10T12:00:00Z",
    } satisfies PrMergedPayload,
    triggeredAt: "2026-04-10T12:00:00Z",
  };
}

function makePhaseFailedEvent(): PipelineEvent<"phase-failed"> {
  return {
    type: "phase-failed",
    payload: {
      issueNumber: 42,
      repo: "test/repo",
      phaseIndex: 2,
      phaseName: "테스트 작성",
      errorCategory: "TS_ERROR",
      errorMessage: "Type error in foo.ts",
      attempt: 1,
    } satisfies PhaseFailedPayload,
    triggeredAt: "2026-04-10T12:01:00Z",
  };
}

function makePipelineCompleteEvent(): PipelineEvent<"pipeline-complete"> {
  return {
    type: "pipeline-complete",
    payload: {
      issueNumber: 42,
      repo: "test/repo",
      prUrl: "https://github.com/test/repo/pull/7",
      totalCostUsd: 0.05,
      durationMs: 12000,
    } satisfies PipelineCompletePayload,
    triggeredAt: "2026-04-10T12:02:00Z",
  };
}

function makePipelineFailedEvent(): PipelineEvent<"pipeline-failed"> {
  return {
    type: "pipeline-failed",
    payload: {
      issueNumber: 42,
      repo: "test/repo",
      state: "PHASE_FAILED",
      errorCategory: "TIMEOUT",
      errorMessage: "Pipeline timed out",
      durationMs: 60000,
    } satisfies PipelineFailedPayload,
    triggeredAt: "2026-04-10T12:03:00Z",
  };
}

describe("automation-dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 각 테스트 전 스케줄러를 비활성 상태로 리셋
    initDispatcher(makeScheduler(false));
  });

  describe("initDispatcher", () => {
    it("스케줄러를 초기화한다", async () => {
      const scheduler = makeScheduler(true);
      initDispatcher(scheduler);
      // 초기화 후 이벤트가 처리되어야 함
      await dispatchPipelineEvent(makePrMergedEvent());
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("pr-merged")
      );
    });
  });

  describe("dispatchPipelineEvent", () => {
    it("스케줄러가 실행 중이 아니면 이벤트를 스킵한다", async () => {
      const scheduler = makeScheduler(false);
      initDispatcher(scheduler);
      await dispatchPipelineEvent(makePrMergedEvent());
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("스케줄러 비활성")
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("pr-merged")
      );
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("파이프라인 이벤트 수신")
      );
    });

    it("스케줄러가 실행 중이면 이벤트 수신 로그를 남긴다", async () => {
      const scheduler = makeScheduler(true);
      initDispatcher(scheduler);
      const event = makePrMergedEvent();
      await dispatchPipelineEvent(event);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("파이프라인 이벤트 수신")
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("pr-merged")
      );
    });

    describe("이벤트 타입별 처리", () => {
      beforeEach(() => {
        initDispatcher(makeScheduler(true));
      });

      it("pr-merged 이벤트를 처리한다", async () => {
        const event = makePrMergedEvent();
        await dispatchPipelineEvent(event);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("PR 병합")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("42")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("7")
        );
      });

      it("phase-failed 이벤트를 처리한다", async () => {
        const event = makePhaseFailedEvent();
        await dispatchPipelineEvent(event);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("Phase 실패")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("테스트 작성")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("2")
        );
      });

      it("pipeline-complete 이벤트를 처리한다", async () => {
        const event = makePipelineCompleteEvent();
        await dispatchPipelineEvent(event);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("파이프라인 완료")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("https://github.com/test/repo/pull/7")
        );
      });

      it("pipeline-failed 이벤트를 처리한다", async () => {
        const event = makePipelineFailedEvent();
        await dispatchPipelineEvent(event);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("파이프라인 실패")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("PHASE_FAILED")
        );
      });

      it("draft-pr-created 이벤트를 처리한다", async () => {
        const event = makeDraftPrCreatedEvent();
        await dispatchPipelineEvent(event);
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("Draft PR 생성")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("42")
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining("7")
        );
      });

      it("draft PR 생성 시 pr-merged 이벤트가 발화되지 않는다 (회귀)", async () => {
        const event = makeDraftPrCreatedEvent();
        await dispatchPipelineEvent(event);
        const infoCalls = mockLogger.info.mock.calls.map((c: unknown[]) => c[0] as string);
        const hasPrMerged = infoCalls.some((msg) => msg.includes("PR 병합"));
        expect(hasPrMerged).toBe(false);
      });
    });

    it("이벤트 처리 중 예외가 발생해도 throw하지 않고 에러 로그를 남긴다", async () => {
      const scheduler = makeScheduler(true);
      initDispatcher(scheduler);

      // processEvent 내부에서 에러를 발생시키기 위해 logger.info를 덮어씀
      let callCount = 0;
      mockLogger.info.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error("unexpected error");
        }
      });

      await expect(dispatchPipelineEvent(makePrMergedEvent())).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("이벤트 처리 실패")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("pr-merged")
      );
    });

    it("스케줄러 중지 후 이벤트를 스킵한다", async () => {
      const scheduler = makeScheduler(true);
      initDispatcher(scheduler);

      // 실행 중일 때는 처리
      await dispatchPipelineEvent(makePrMergedEvent());
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("파이프라인 이벤트 수신")
      );

      vi.clearAllMocks();

      // 중지 후에는 스킵
      scheduler.stop();
      await dispatchPipelineEvent(makePrMergedEvent());
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("스케줄러 비활성")
      );
    });

    it("여러 이벤트를 순서대로 처리한다", async () => {
      const scheduler = makeScheduler(true);
      initDispatcher(scheduler);

      await dispatchPipelineEvent(makePhaseFailedEvent());
      await dispatchPipelineEvent(makePipelineFailedEvent());

      const infoCalls = mockLogger.info.mock.calls.map((c: unknown[]) => c[0] as string);
      const phaseFailedIdx = infoCalls.findIndex((msg) => msg.includes("Phase 실패"));
      const pipelineFailedIdx = infoCalls.findIndex((msg) => msg.includes("파이프라인 실패"));
      expect(phaseFailedIdx).toBeLessThan(pipelineFailedIdx);
    });
  });
});
