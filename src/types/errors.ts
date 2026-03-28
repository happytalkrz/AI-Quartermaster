export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class SafetyViolationError extends Error {
  constructor(
    public readonly guard: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[${guard}] ${message}`);
    this.name = "SafetyViolationError";
  }
}

export class TimeoutError extends Error {
  constructor(
    public readonly stage: string,
    public readonly timeoutMs: number
  ) {
    super(`Timeout in ${stage} after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export class RollbackError extends Error {
  constructor(
    public readonly targetHash: string,
    message: string
  ) {
    super(`Rollback to ${targetHash} failed: ${message}`);
    this.name = "RollbackError";
  }
}
