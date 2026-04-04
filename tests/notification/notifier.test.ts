import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWebhookNotification } from "../../src/notification/notifier.js";
import type { WebhookPayload } from "../../src/types/notification.js";

// fetch mock
global.fetch = vi.fn();

describe("sendWebhookNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // console.error mock to suppress error logs in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Discord/Slack 호환 형식으로 webhook을 전송한다", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

    const payload: WebhookPayload = {
      repo: "owner/test-repo",
      issueNumber: 123,
      error: "Test error message",
      errorCategory: "COMPILE_ERROR",
      prUrl: "https://github.com/owner/test-repo/pull/456",
    };

    await sendWebhookNotification("https://discord.com/api/webhooks/123/abc", payload);

    expect(fetch).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/abc",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: expect.stringContaining("AI Quartermaster - Job 실패"),
      }
    );

    const callArgs = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string);

    expect(body).toHaveProperty("text");
    expect(body).toHaveProperty("content");
    expect(body.text).toContain("owner/test-repo");
    expect(body.text).toContain("#123");
    expect(body.text).toContain("Test error message");
    expect(body.text).toContain("COMPILE_ERROR");
    expect(body.text).toContain("https://github.com/owner/test-repo/pull/456");
  });

  it("긴 에러 메시지를 500자로 제한한다", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

    const longError = "A".repeat(600);
    const payload: WebhookPayload = {
      repo: "owner/test-repo",
      issueNumber: 123,
      error: longError,
    };

    await sendWebhookNotification("https://discord.com/api/webhooks/123/abc", payload);

    const callArgs = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string);

    expect(body.text).toContain("A".repeat(500) + "...");
    expect(body.text).not.toContain("A".repeat(501));
  });

  it("선택적 필드들을 올바르게 처리한다", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

    const payload: WebhookPayload = {
      repo: "owner/test-repo",
      issueNumber: 123,
      error: "Simple error",
    };

    await sendWebhookNotification("https://discord.com/api/webhooks/123/abc", payload);

    const callArgs = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string);

    expect(body.text).not.toContain("Error Category");
    expect(body.text).not.toContain("PR:");
  });

  it("HTTP 에러 시 로깅만 하고 예외를 던지지 않는다", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
    };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as Response);

    const payload: WebhookPayload = {
      repo: "owner/test-repo",
      issueNumber: 123,
      error: "Test error",
    };

    // 예외가 발생하지 않아야 함
    await expect(sendWebhookNotification("https://invalid-webhook-url", payload))
      .resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalled();
  });

  it("네트워크 에러 시 로깅만 하고 예외를 던지지 않는다", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const payload: WebhookPayload = {
      repo: "owner/test-repo",
      issueNumber: 123,
      error: "Test error",
    };

    // 예외가 발생하지 않아야 함
    await expect(sendWebhookNotification("https://webhook-url", payload))
      .resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalled();
  });
});