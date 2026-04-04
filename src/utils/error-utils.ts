import { AQMError } from '../types/errors.js';

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