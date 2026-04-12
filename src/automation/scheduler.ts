import * as cron from "node-cron";
import type { AQConfig } from "../types/config.js";
import type { AutomationRule, RuleContext, RuleEngineHandlers } from "../types/automation.js";
import { evaluateRule, executeAction } from "./rule-engine.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

/**
 * 자동화 규칙 스케줄러 — cron 스케줄에 따라 자동화 규칙을 평가하고,
 * 파이프라인 이벤트(pr-merged, phase-failed, pipeline-complete, pipeline-failed)를 수신하여 사용자 정의 액션을 실행.
 */
export class AutomationScheduler {
  private config: AQConfig;
  private running = false;
  private cronTasks: cron.ScheduledTask[] = [];
  private automationRules: AutomationRule[] = [];
  private handlers: RuleEngineHandlers;

  constructor(config: AQConfig, automationRules: AutomationRule[], handlers: RuleEngineHandlers) {
    this.config = config;
    this.automationRules = automationRules;
    this.handlers = handlers;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // cron 트리거가 있는 규칙들을 스케줄에 등록
    this.setupCronJobs();

    logger.info("AutomationScheduler 시작됨 — 파이프라인 이벤트 트리거 대기 중");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    // 모든 cron 작업 중지
    this.cronTasks.forEach(task => {
      task.stop();
    });
    this.cronTasks = [];

    logger.info("AutomationScheduler 중지됨");
  }

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(newConfig: AQConfig): void {
    this.config = newConfig;
  }

  updateAutomationRules(rules: AutomationRule[]): void {
    this.automationRules = rules;

    if (this.running) {
      // 기존 cron 작업들을 중지하고 새로 설정
      this.cronTasks.forEach(task => task.stop());
      this.cronTasks = [];
      this.setupCronJobs();
    }
  }

  private setupCronJobs(): void {
    const cronRules = this.automationRules.filter(rule =>
      rule.trigger.type === "cron" && rule.enabled !== false
    );

    cronRules.forEach(rule => {
      if (rule.trigger.type === "cron") {
        const cronExpression = this.getCronExpression(rule.trigger.schedule);

        const task = cron.schedule(cronExpression, () => {
          this.executeCronRule(rule);
        }, {
          scheduled: true,
          timezone: "Asia/Seoul"
        });

        this.cronTasks.push(task);
        logger.info(`[AutomationScheduler] cron 작업 등록됨: ${rule.id} (${rule.trigger.schedule})`);
      }
    });
  }

  private getCronExpression(schedule: "daily" | "weekly"): string {
    switch (schedule) {
      case "daily":
        return "0 9 * * *"; // 매일 오전 9시
      case "weekly":
        return "0 9 * * 1"; // 매주 월요일 오전 9시
    }
  }

  private async executeCronRule(rule: AutomationRule): Promise<void> {
    try {
      logger.info(`[AutomationScheduler] cron 규칙 실행 중: ${rule.id}`);

      // cron 트리거용 더미 컨텍스트 생성
      const dummyContext: RuleContext = {
        triggerType: "cron",
        issue: {
          number: 0,
          title: "Automated cron trigger",
          body: "This is an automated trigger from cron schedule",
          labels: []
        },
        repo: "scheduled"
      };

      // 규칙 평가
      if (evaluateRule(rule, dummyContext)) {
        logger.info(`[AutomationScheduler] 규칙 조건 통과: ${rule.id}`);

        // 액션들 실행
        for (const action of rule.actions) {
          await executeAction(action, dummyContext, this.handlers);
        }
      } else {
        logger.debug(`[AutomationScheduler] 규칙 조건 미충족: ${rule.id}`);
      }
    } catch (err) {
      logger.error(`[AutomationScheduler] cron 규칙 실행 실패 (${rule.id}):`, err);
    }
  }
}
