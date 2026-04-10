import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AQConfig } from "../../src/types/config.js";
import type { AutomationRule, RuleEngineHandlers } from "../../src/types/automation.js";
import { AutomationScheduler } from "../../src/automation/scheduler.js";

// node-cron 모킹
vi.mock("node-cron", () => {
  const mockStop = vi.fn();
  const mockSchedule = vi.fn();

  return {
    schedule: mockSchedule,
    __mockSchedule: mockSchedule,
    __mockStop: mockStop
  };
});

// rule-engine 모킹
vi.mock("../../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn()
}));

// logger 모킹
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  })
}));

describe("AutomationScheduler", () => {
  let scheduler: AutomationScheduler;
  let mockConfig: AQConfig;
  let mockRules: AutomationRule[];
  let mockHandlers: RuleEngineHandlers;
  let mockSchedule: ReturnType<typeof vi.fn>;
  let mockStop: ReturnType<typeof vi.fn>;
  let mockEvaluateRule: ReturnType<typeof vi.fn>;
  let mockExecuteAction: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 모킹된 함수들 가져오기
    const cronMock = await import("node-cron");
    const ruleEngineMock = await import("../../src/automation/rule-engine.js");

    mockSchedule = vi.mocked(cronMock.schedule);
    mockStop = vi.fn();
    mockEvaluateRule = vi.mocked(ruleEngineMock.evaluateRule);
    mockExecuteAction = vi.mocked(ruleEngineMock.executeAction);

    // Mock된 ScheduledTask 객체
    const mockTask = {
      stop: mockStop
    };
    mockSchedule.mockReturnValue(mockTask);

    mockConfig = {} as AQConfig;

    mockHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn().mockResolvedValue(undefined)
    };

    mockRules = [
      {
        id: "daily-rule",
        name: "Daily automation",
        enabled: true,
        trigger: { type: "cron", schedule: "daily" },
        actions: [{ type: "add-label", labels: ["daily-check"] }]
      },
      {
        id: "weekly-rule",
        name: "Weekly automation",
        enabled: true,
        trigger: { type: "cron", schedule: "weekly" },
        actions: [{ type: "start-job" }]
      },
      {
        id: "disabled-rule",
        name: "Disabled cron rule",
        enabled: false,
        trigger: { type: "cron", schedule: "daily" },
        actions: [{ type: "pause-project" }]
      },
      {
        id: "non-cron-rule",
        name: "Issue created rule",
        trigger: { type: "issue-created" },
        actions: [{ type: "add-label", labels: ["auto"] }]
      }
    ];

    scheduler = new AutomationScheduler(mockConfig, mockRules, mockHandlers);
  });

  afterEach(() => {
    if (scheduler.isRunning()) {
      scheduler.stop();
    }
  });

  describe("생명주기", () => {
    it("초기 상태는 중지됨", () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it("start() 호출 시 실행 상태가 됨", () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it("stop() 호출 시 중지 상태가 됨", () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("이미 실행 중일 때 start() 재호출해도 무시됨", () => {
      scheduler.start();
      const firstCallCount = mockSchedule.mock.calls.length;

      scheduler.start(); // 재호출
      const secondCallCount = mockSchedule.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount); // cron 작업이 중복 등록되지 않음
    });

    it("이미 중지됨 상태에서 stop() 재호출해도 무시됨", () => {
      scheduler.stop(); // 이미 중지됨
      expect(mockStop).not.toHaveBeenCalled();
    });
  });

  describe("cron 잡 등록", () => {
    it("start() 시 cron 트리거 규칙들이 스케줄에 등록됨", () => {
      scheduler.start();

      // enabled=true인 cron 규칙만 등록되어야 함 (daily-rule, weekly-rule)
      expect(mockSchedule).toHaveBeenCalledTimes(2);

      // daily 규칙
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 9 * * *", // daily cron expression
        expect.any(Function),
        { scheduled: true, timezone: "Asia/Seoul" }
      );

      // weekly 규칙
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 9 * * 1", // weekly cron expression
        expect.any(Function),
        { scheduled: true, timezone: "Asia/Seoul" }
      );
    });

    it("disabled 규칙은 스케줄에 등록되지 않음", () => {
      scheduler.start();

      // disabled-rule은 제외되고 daily-rule, weekly-rule만 등록
      expect(mockSchedule).toHaveBeenCalledTimes(2);
    });

    it("non-cron 트리거 규칙은 스케줄에 등록되지 않음", () => {
      scheduler.start();

      // non-cron-rule은 제외되고 cron 트리거만 등록
      expect(mockSchedule).toHaveBeenCalledTimes(2);
    });

    it("stop() 시 모든 cron 작업이 중지됨", () => {
      scheduler.start();
      scheduler.stop();

      expect(mockStop).toHaveBeenCalledTimes(2);
    });
  });

  describe("규칙 평가 호출", () => {
    it("cron 실행 시 RuleEngine.evaluateRule이 호출됨", async () => {
      mockEvaluateRule.mockReturnValue(true);

      scheduler.start();

      // 첫 번째 cron 작업의 콜백 함수 실행
      const cronCallback = mockSchedule.mock.calls[0][1];
      await cronCallback();

      expect(mockEvaluateRule).toHaveBeenCalledWith(
        mockRules[0], // daily-rule
        expect.objectContaining({
          triggerType: "cron",
          issue: expect.objectContaining({
            number: 0,
            title: "Automated cron trigger"
          }),
          repo: "scheduled"
        })
      );
    });

    it("규칙 평가 통과 시 액션이 실행됨", async () => {
      mockEvaluateRule.mockReturnValue(true);

      scheduler.start();

      const cronCallback = mockSchedule.mock.calls[0][1];
      await cronCallback();

      expect(mockExecuteAction).toHaveBeenCalledWith(
        { type: "add-label", labels: ["daily-check"] },
        expect.any(Object),
        mockHandlers
      );
    });

    it("규칙 평가 실패 시 액션이 실행되지 않음", async () => {
      mockEvaluateRule.mockReturnValue(false);

      scheduler.start();

      const cronCallback = mockSchedule.mock.calls[0][1];
      await cronCallback();

      expect(mockExecuteAction).not.toHaveBeenCalled();
    });
  });

  describe("updateAutomationRules", () => {
    it("실행 중일 때 규칙 업데이트 시 cron 작업이 재설정됨", () => {
      scheduler.start();
      expect(mockSchedule).toHaveBeenCalledTimes(2);

      // 새로운 규칙으로 업데이트
      const newRules: AutomationRule[] = [
        {
          id: "new-daily-rule",
          name: "New daily automation",
          trigger: { type: "cron", schedule: "daily" },
          actions: [{ type: "start-job" }]
        }
      ];

      scheduler.updateAutomationRules(newRules);

      // 기존 작업들이 중지되고 새 작업이 등록됨
      expect(mockStop).toHaveBeenCalledTimes(2); // 기존 2개 작업 중지
      expect(mockSchedule).toHaveBeenCalledTimes(3); // 기존 2개 + 새 1개
    });

    it("중지 상태일 때 규칙 업데이트는 즉시 반영되지 않음", () => {
      const newRules: AutomationRule[] = [];
      scheduler.updateAutomationRules(newRules);

      expect(mockStop).not.toHaveBeenCalled();
      expect(mockSchedule).not.toHaveBeenCalled();
    });
  });

  describe("cron 표현식 변환", () => {
    it("daily 스케줄은 매일 오전 9시로 변환됨", () => {
      scheduler.start();

      const dailyCall = mockSchedule.mock.calls.find(call =>
        call[0] === "0 9 * * *"
      );
      expect(dailyCall).toBeDefined();
    });

    it("weekly 스케줄은 매주 월요일 오전 9시로 변환됨", () => {
      scheduler.start();

      const weeklyCall = mockSchedule.mock.calls.find(call =>
        call[0] === "0 9 * * 1"
      );
      expect(weeklyCall).toBeDefined();
    });
  });

  describe("updateConfig", () => {
    it("config 업데이트가 정상 동작함", () => {
      const newConfig = { test: "value" } as unknown as AQConfig;
      scheduler.updateConfig(newConfig);

      // 에러가 발생하지 않으면 성공
      expect(true).toBe(true);
    });
  });
});