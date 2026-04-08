
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

/**
 * Discriminated union for classified errors with category-specific metadata
 */
export type ClassifiedError =
  | TSError
  | TimeoutErrorClassified
  | CliCrashError
  | VerificationFailedErrorClassified
  | SafetyViolationErrorClassified
  | RateLimitError
  | PromptTooLongError
  | UnknownErrorClassified;

export interface TSError {
  category: "TS_ERROR";
  message: string;
  fileName?: string;
  line?: number;
  column?: number;
  errorCode?: string;
  diagnosticMessage?: string;
}

export interface TimeoutErrorClassified {
  category: "TIMEOUT";
  message: string;
  stage: string;
  timeoutMs: number;
  elapsedMs?: number;
}

export interface CliCrashError {
  category: "CLI_CRASH";
  message: string;
  command: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
}

export interface VerificationFailedErrorClassified {
  category: "VERIFICATION_FAILED";
  message: string;
  verificationType: "TEST" | "LINT" | "TYPE_CHECK" | "BUILD" | "OTHER";
  failureDetails?: string;
  affectedFiles?: string[];
}

export interface SafetyViolationErrorClassified {
  category: "SAFETY_VIOLATION";
  message: string;
  guard: string;
  violationType: "PATH_RESTRICTION" | "LABEL_MISSING" | "TIMEOUT" | "RESOURCE_LIMIT" | "OTHER";
  details?: Record<string, unknown>;
}

export interface RateLimitError {
  category: "RATE_LIMIT";
  message: string;
  api: string;
  retryAfterMs?: number;
  currentUsage?: number;
  limit?: number;
  resetTime?: string;
}

export interface PromptTooLongError {
  category: "PROMPT_TOO_LONG";
  message: string;
  currentTokens: number;
  maxTokens: number;
  excessTokens: number;
  suggestedAction?: "TRUNCATE" | "SPLIT" | "COMPRESS";
}

export interface UnknownErrorClassified {
  category: "UNKNOWN";
  message: string;
  originalError?: string;
  context?: Record<string, unknown>;
}
