import type { Job, UsageInfo, PhaseResultInfo } from "../types/pipeline.js";
import { JobStore } from "./job-store.js";

/**
 * Appends log messages to a job and updates its current step.
 * Used by the pipeline to record progress that's visible in the dashboard.
 */
export class JobLogger {
  constructor(
    private store: JobStore,
    private jobId: string
  ) {}

  log(message: string): void {
    const job = this.store.get(this.jobId);
    if (!job) return;
    const logs = job.logs ?? [];
    logs.push(`[${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}] ${message}`);
    this.store.update(this.jobId, { logs, lastUpdatedAt: new Date().toISOString() });
  }

  setStep(step: string): void {
    this.store.update(this.jobId, { currentStep: step });
    this.log(step);
  }

  setPhaseResults(results: PhaseResultInfo[]): void {
    this.store.update(this.jobId, { phaseResults: results });
  }

  setProgress(progress: number): void {
    this.store.update(this.jobId, { progress: Math.round(progress) });
  }

  setCosts(totalCostUsd: number, totalUsage?: UsageInfo): void {
    const updates: Partial<Job> = { totalCostUsd, totalUsage };
    this.store.update(this.jobId, updates);
  }
}
