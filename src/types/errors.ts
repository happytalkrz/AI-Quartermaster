/**
 * @deprecated Use getErrorMessage from src/utils/error-utils.ts instead
 */
export function errorMessage(err: unknown): string {
  // Delegate to the new function to maintain compatibility
  return err instanceof Error ? err.message : String(err);
}

/**
 * Base error class for AI-Quartermaster with standardized error handling
 */
export abstract class AQMError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: Error | unknown
  ) {
    super(message);
    this.name = this.constructor.name;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SafetyViolationError extends AQMError {
  constructor(
    public readonly guard: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super("SAFETY_VIOLATION", `[${guard}] ${message}`);
  }
}

export class TimeoutError extends AQMError {
  constructor(
    public readonly stage: string,
    public readonly timeoutMs: number
  ) {
    super("TIMEOUT", `Timeout in ${stage} after ${timeoutMs}ms`);
  }
}

export class RollbackError extends AQMError {
  constructor(
    public readonly targetHash: string,
    message: string
  ) {
    super("ROLLBACK_FAILED", `Rollback to ${targetHash} failed: ${message}`);
  }
}
