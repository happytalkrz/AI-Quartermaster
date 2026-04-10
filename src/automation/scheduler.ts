import type { AQConfig } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * 자동화 규칙 스케줄러 — 파이프라인 이벤트(pr-merged, phase-failed,
 * pipeline-complete, pipeline-failed)를 수신하여 사용자 정의 액션을 실행.
 */
export class AutomationScheduler {
  private config: AQConfig;
  private running = false;

  constructor(config: AQConfig) {
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("AutomationScheduler 시작됨 — 파이프라인 이벤트 트리거 대기 중");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    logger.info("AutomationScheduler 중지됨");
  }

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(newConfig: AQConfig): void {
    this.config = newConfig;
  }
}
