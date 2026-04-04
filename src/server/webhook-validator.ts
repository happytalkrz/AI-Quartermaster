import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies GitHub webhook signature using HMAC-SHA256.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (error: unknown) {
    return false; // different lengths
  }
}
