/**
 * Masks sensitive information in configuration objects.
 * Recursively processes nested objects and arrays to hide sensitive data.
 */

const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /token/i,
  /key$/i,
  /apikey/i,
  /github_webhook_secret/i,
] as const;

const MASK_VALUE = "********";

/**
 * Checks if a key name matches any sensitive pattern.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Recursively masks sensitive values in an object or array.
 * Returns a new object/array without modifying the original.
 */
function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => maskValue(item));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveKey(key) && val !== null && val !== undefined) {
        result[key] = MASK_VALUE;
      } else {
        result[key] = maskValue(val);
      }
    }
    return result;
  }

  return value;
}

/**
 * Masks sensitive information in a configuration object.
 * Creates a deep copy with sensitive values replaced by asterisks.
 *
 * @param config - The configuration object to mask
 * @returns A new object with sensitive values masked
 */
export function maskSensitiveConfig<T>(config: T): T {
  return maskValue(config) as T;
}