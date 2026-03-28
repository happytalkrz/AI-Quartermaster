/**
 * Creates a URL-safe slug from a string.
 * - Removes Korean/CJK characters
 * - Removes special characters (keeps alphanumeric and hyphens)
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 * - Max 50 characters
 * - Lowercased
 */
export function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u3131-\uD79D\u4E00-\u9FFF\u3400-\u4DBF]/g, "") // Remove Korean/CJK
    .replace(/[^a-z0-9]+/g, "-") // Non-alphanumeric to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing
    .slice(0, 50); // Max length
}

/**
 * Returns a URL-safe slug with a fallback for empty results (e.g. Korean-only titles).
 */
export function createSlugWithFallback(text: string, fallback = "impl"): string {
  return createSlug(text) || fallback;
}
