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
 * Extracts error message from unknown error type in a type-safe way
 * @param err - The error object (can be any type)
 * @returns The error message as a string, with error code for AQMError instances
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof AQMError) {
    return `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}