import type {
  PipelineEvent,
  PrMergedPayload,
  PhaseFailedPayload,
  PipelineCompletePayload,
  PipelineFailedPayload,
} from "../../types/pipeline.js";
import { AutomationScheduler } from "../../automation/scheduler.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";

const logger = getLogger();

let _scheduler: AutomationScheduler | null = null;

/**
 * 디스패처를 AutomationScheduler 인스턴스로 초기화한다.
 * dispatchPipelineEvent 호출 전에 반드시 실행되어야 한다.
 */
export function initDispatcher(scheduler: AutomationScheduler): void {
  _scheduler = scheduler;
}

/**
 * 파이프라인 이벤트를 자동화 규칙 엔진에 디스패치한다.
 * 스케줄러가 실행 중일 때만 동작하며, 이벤트 타입에 따라 해당 액션을 실행한다.
 */
export async function dispatchPipelineEvent(event: PipelineEvent): Promise<void> {
  if (!_scheduler?.isRunning()) {
    logger.debug(`[AutomationDispatcher] 스케줄러 비활성 — 이벤트 스킵: ${event.type}`);
    return;
  }

  logger.info(
    `[AutomationDispatcher] 파이프라인 이벤트 수신: ${event.type} (triggeredAt: ${event.triggeredAt})`
  );

  try {
    await processEvent(event);
  } catch (err: unknown) {
    logger.error(
      `[AutomationDispatcher] 이벤트 처리 실패 [${event.type}]: ${getErrorMessage(err)}`
    );
  }
}

async function processEvent(event: PipelineEvent): Promise<void> {
  switch (event.type) {
    case "pr-merged": {
      const p = event.payload as PrMergedPayload;
      logger.info(
        `[AutomationDispatcher] PR 병합 — 이슈 #${p.issueNumber} PR #${p.prNumber} (${p.repo})`
      );
      break;
    }
    case "phase-failed": {
      const p = event.payload as PhaseFailedPayload;
      logger.info(
        `[AutomationDispatcher] Phase 실패 — 이슈 #${p.issueNumber} Phase ${p.phaseIndex} "${p.phaseName}" (${p.repo})`
      );
      break;
    }
    case "pipeline-complete": {
      const p = event.payload as PipelineCompletePayload;
      logger.info(
        `[AutomationDispatcher] 파이프라인 완료 — 이슈 #${p.issueNumber} PR: ${p.prUrl} (${p.repo})`
      );
      break;
    }
    case "pipeline-failed": {
      const p = event.payload as PipelineFailedPayload;
      logger.info(
        `[AutomationDispatcher] 파이프라인 실패 — 이슈 #${p.issueNumber} 상태: ${p.state} (${p.repo})`
      );
      break;
    }
  }
}
