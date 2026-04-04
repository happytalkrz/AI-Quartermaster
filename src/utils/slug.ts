/**
 * Creates a URL-safe slug from a string.
 * - Removes Korean/CJK characters
 * - Removes special characters (keeps alphanumeric and hyphens)
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 * - Max 50 characters
 * - Lowercased
 * - Sanitizes path traversal characters (../, ./, \, absolute paths)
 */
export function createSlug(text: string): string {
  return text
    .toLowerCase()
    // Remove path traversal characters first for security, but keep structure for hyphen conversion
    .replace(/\.\./g, "") // Remove ".." (parent directory)
    .replace(/^[.]+/g, "") // Remove leading dots
    .replace(/[\u3131-\uD79D\u4E00-\u9FFF\u3400-\u4DBF]/g, "") // Remove Korean/CJK
    .replace(/[^a-z0-9]+/g, "-") // Non-alphanumeric to hyphens (includes slashes)
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing
    .slice(0, 50); // Max length
}

/**
 * Validates that a string contains no path traversal characters.
 * Returns true if safe, false if contains dangerous characters.
 */
export function isPathSafe(path: string): boolean {
  if (!path || typeof path !== 'string') return false;

  // Check for path traversal patterns
  const dangerousPatterns = [
    /\.\./,           // Parent directory ".."
    /^\.\//,          // Current directory "./"
    /^[/\\]/,         // Absolute path (starts with / or \)
    /[/\\]$/,         // Ends with slash
    /[/\\]{2,}/,      // Multiple consecutive slashes
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/,   // Control characters
    /[<>:"|?*]/       // Windows forbidden characters
  ];

  return !dangerousPatterns.some(pattern => pattern.test(path));
}

/**
 * Returns a URL-safe slug with a fallback for empty results (e.g. Korean-only titles).
 * Validates path safety before returning.
 */
export function createSlugWithFallback(text: string, fallback = "impl"): string {
  const slug = createSlug(text) || fallback;

  // Double-check path safety (defense in depth)
  if (!isPathSafe(slug)) {
    throw new Error(`Generated slug contains unsafe path characters: ${slug}`);
  }

  return slug;
}
