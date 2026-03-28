import { describe, it, expect } from "vitest";
import { verifyWebhookSignature } from "../../src/server/webhook-validator.js";
import { createHmac } from "crypto";

describe("verifyWebhookSignature", () => {
  const secret = "test-secret";
  const payload = '{"action":"labeled"}';

  function sign(body: string, s: string): string {
    return "sha256=" + createHmac("sha256", s).update(body).digest("hex");
  }

  it("should return true for valid signature", () => {
    const sig = sign(payload, secret);
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it("should return false for invalid signature", () => {
    expect(verifyWebhookSignature(payload, "sha256=invalid", secret)).toBe(false);
  });

  it("should return false for missing signature", () => {
    expect(verifyWebhookSignature(payload, undefined, secret)).toBe(false);
  });

  it("should return false for wrong secret", () => {
    const sig = sign(payload, "wrong-secret");
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(false);
  });
});
