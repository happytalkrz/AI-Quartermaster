import { executePhase, type PhaseExecutorContext } from "./phase-executor.js";
import type { PhaseResult } from "../../types/pipeline.js";

export interface PhaseExecutor {
  execute(ctx: PhaseExecutorContext): Promise<PhaseResult>;
}

const claudePhaseExecutor: PhaseExecutor = {
  execute(ctx: PhaseExecutorContext): Promise<PhaseResult> {
    return executePhase(ctx);
  },
};

export function selectExecutor(mode: "code" | "content" | "qa" | undefined): PhaseExecutor {
  if (mode === "qa") {
    throw new Error("qa executor not implemented");
  }
  return claudePhaseExecutor;
}
