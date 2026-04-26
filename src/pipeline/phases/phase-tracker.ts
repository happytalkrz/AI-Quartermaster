import type { Clock } from "../../utils/clock.js";
import { systemClock } from "../../utils/clock.js";
import type { PhaseResult } from "../../types/pipeline.js";
import type { OrchestratorInput, PipelineRuntime } from "../core/pipeline-context.js";
import type { GitHubIssue } from "../../github/issue-fetcher.js";
import type { ResolvedProject } from "../../config/project-resolver.js";
import type { AQConfig, PipelineMode } from "../../types/config.js";
import type { PipelineTimer } from "../../safety/timeout-manager.js";
import type { HookRegistry } from "../../hooks/hook-registry.js";
import type { HookExecutor } from "../../hooks/hook-executor.js";
import type { EnvironmentSetupResult } from "./pipeline-phases.js";
import {
  makePseudoPhaseSuccess,
  makePseudoPhaseFailure,
  type PseudoPhaseName,
} from "../reporting/phase-result-helper.js";

/**
 * core-loop phase 실행 시 필요한 의존성을 묶은 context 객체.
 * 파라미터 폭주(`executeCoreLoopPhase` 12개)를 단일 객체로 정리한다.
 */
export interface CoreLoopPhaseContext {
  input: OrchestratorInput;
  runtime: PipelineRuntime;
  issue: GitHubIssue;
  project: ResolvedProject;
  config: AQConfig;
  promptsDir: string;
  dataDir: string;
  envResult: EnvironmentSetupResult;
  timer: PipelineTimer;
  mode: PipelineMode;
  hooks?: { registry: HookRegistry; executor: HookExecutor };
  clock?: Clock;
}

export interface PhaseTrackingResult<T> {
  result: T;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

interface TrackablePhaseResult {
  success: boolean;
  error?: string;
  costUsd?: number;
}

/**
 * pseudo-phase의 측정·기록 패턴을 단일화한다.
 *
 * `runner`를 실행하면서 시작/종료 시각·소요시간을 측정하고, `accumulated`가 주어지면
 * 결과의 `success` 값에 따라 PhaseResult를 누적 배열에 push한다. runner 내부 예외는
 * 호출부가 처리하도록 그대로 throw한다 (성공/실패 분기는 결과 객체의 `success`를 통해 표현).
 *
 * @param phaseName pseudo-phase 식별자 (`makePseudoPhase*` 키와 동일)
 * @param runner 측정 대상 비동기 작업
 * @param accumulated 누적 PhaseResult 배열 (선택)
 * @param clock 시간 주입 (테스트용, 생략 시 systemClock)
 */
export async function runPhaseWithTracking<T extends TrackablePhaseResult>(
  phaseName: PseudoPhaseName,
  runner: () => Promise<T>,
  accumulated?: PhaseResult[],
  clock: Clock = systemClock
): Promise<PhaseTrackingResult<T>> {
  const startedAt = clock.nowIso();
  const startMs = clock.nowMs();
  const result = await runner();
  const durationMs = clock.nowMs() - startMs;
  const completedAt = clock.nowIso();

  if (accumulated) {
    if (result.success) {
      accumulated.push(
        makePseudoPhaseSuccess(phaseName, durationMs, {
          startedAt,
          completedAt,
          costUsd: result.costUsd,
        })
      );
    } else {
      accumulated.push(
        makePseudoPhaseFailure(
          phaseName,
          durationMs,
          result.error ?? `${phaseName} failed`,
          {
            startedAt,
            completedAt,
            costUsd: result.costUsd,
          }
        )
      );
    }
  }

  return { result, durationMs, startedAt, completedAt };
}
