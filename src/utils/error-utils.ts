import { AQMError } from '../types/errors.js';

/**
 * Type guard to check if an unknown error is an AQMError instance
 * @param err - The value to check
 * @returns true if err is an AQMError instance
 */
export function isAQMError(err: unknown): err is AQMError {
  return err instanceof AQMError;
}

/**
 * Converts an unknown caught value to an Error instance in a type-safe way.
 * - If already an Error, returns as-is.
 * - If a string, wraps in new Error(string).
 * - Otherwise, wraps String(value) in new Error.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === 'string') {
    return new Error(err);
  }
  return new Error(String(err));
}

export interface GetErrorMessageOptions {
  /** Include cause chain in the message (appended as ": <cause>") */
  includeCause?: boolean;
}

/**
 * Extracts error message from unknown error type in a type-safe way.
 * @param err - The error object (can be any type)
 * @param options - Optional configuration
 * @returns The error message as a string, with error code for AQMError instances
 */
export function getErrorMessage(err: unknown, options?: GetErrorMessageOptions): string {
  const base = extractBaseMessage(err);

  if (!options?.includeCause) {
    return base;
  }

  const cause = getCause(err);
  if (cause === undefined) {
    return base;
  }
  return `${base}: ${getErrorMessage(cause, options)}`;
}

function extractBaseMessage(err: unknown): string {
  if (err instanceof AQMError) {
    return `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}

function getCause(err: unknown): unknown {
  if (err instanceof AQMError) {
    return err.cause;
  }
  if (err instanceof Error && 'cause' in err) {
    return (err as Error & { cause?: unknown }).cause;
  }
  return undefined;
}