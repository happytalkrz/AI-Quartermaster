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