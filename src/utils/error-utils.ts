import { AQMError } from "../types/errors.js";

/**
 * Type guard to check if an error is an instance of AQMError
 */
export function isAQMError(error: unknown): error is AQMError {
  return error instanceof AQMError;
}

/**
 * Extracts error message from unknown error type in a type-safe way
 * @param err - The error object (can be any type)
 * @returns The error message as a string
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Extracts error stack trace if available
 * @param err - The error object
 * @returns The stack trace as a string, or undefined if not available
 */
export function getErrorStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }
  return undefined;
}

/**
 * Gets error code from AQMError or returns undefined
 * @param err - The error object
 * @returns The error code if it's an AQMError, undefined otherwise
 */
export function getErrorCode(err: unknown): string | undefined {
  if (isAQMError(err)) {
    return err.code;
  }
  return undefined;
}

/**
 * Creates a structured error information object
 * @param err - The error object
 * @returns Object containing message, code, stack, and type information
 */
export function getErrorInfo(err: unknown): {
  message: string;
  code?: string;
  stack?: string;
  isAQMError: boolean;
  type: string;
} {
  return {
    message: getErrorMessage(err),
    code: getErrorCode(err),
    stack: getErrorStack(err),
    isAQMError: isAQMError(err),
    type: err instanceof Error ? err.constructor.name : typeof err,
  };
}