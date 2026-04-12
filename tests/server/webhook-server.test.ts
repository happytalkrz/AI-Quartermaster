import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AQConfig } from "../../src/types/config.js";

// Mock dependencies
vi.mock("../../src/server/webhook-validator.js", () => ({
  verifyWebhookSignature: vi.fn(),
}));

vi.mock("../../src/server/event-dispatcher.js", () => ({
  dispatchEvent: vi.fn(),
}));

vi.mock("../../src/safety/label-filter.js", () => ({
  getTriggerLabels: vi.fn().mockReturnValue(["aqm"]),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@hono/node-server", () => ({
  serve: vi.fn(),
}));

import { Hono } from "hono";
import { createWebhookApp, startServer } from "../../src/server/webhook-server.js";
import { verifyWebhookSignature } from "../../src/server/webhook-validator.js";
import { dispatchEvent } from "../../src/server/event-dispatcher.js";
import { serve } from "@hono/node-server";

const mockVerify = vi.mocked(verifyWebhookSignature);
const mockDispatch = vi.mocked(dispatchEvent);
const mockServe = vi.mocked(serve);

const makeConfig = (): AQConfig => ({
  general: {
    instanceLabel: "aqm",
    instanceOwners: [],
  },
  safety: {
    allowedLabels: ["aqm"],
  },
} as unknown as AQConfig);

const makePayload = (overrides = {}) => ({
  action: "labeled",
  issue: {
    number: 42,
    title: "Test",
    body: "Body",
    labels: [{ name: "aqm" }],
    user: { login: "user" },
  },
  repository: {
    full_name: "test/repo",
    default_branch: "main",
  },
  ...overrides,
});

const makeOptions = (onPipelineTrigger = vi.fn()) => ({
  config: makeConfig(),
  webhookSecret: "secret",
  onPipelineTrigger,
});

function makeRequest(body: string, signature: string | null, eventType = "issues") {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-GitHub-Event": eventType,
    "X-GitHub-Delivery": "delivery-123",
  };
  if (signature !== null) {
    headers["X-Hub-Signature-256"] = signature;
  }
  return new Request("http://localhost/webhook/github", {
    method: "POST",
    headers,
    body,
  });
}

describe("createWebhookApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when signature is invalid", async () => {
    mockVerify.mockReturnValue(false);

    const app = createWebhookApp(makeOptions());
    const body = JSON.stringify(makePayload());
    const res = await app.request(makeRequest(body, "sha256=invalid"));

    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Invalid signature");
  });

  it("returns 401 when signature header is missing", async () => {
    mockVerify.mockReturnValue(false);

    const app = createWebhookApp(makeOptions());
    const body = JSON.stringify(makePayload());
    const res = await app.request(makeRequest(body, null));

    expect(res.status).toBe(401);
  });

  it("returns 400 when body is invalid JSON", async () => {
    mockVerify.mockReturnValue(true);

    const app = createWebhookApp(makeOptions());
    const res = await app.request(makeRequest("not-json", "sha256=valid"));

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Invalid JSON payload");
  });

  it("returns 202 when event should be processed", async () => {
    mockVerify.mockReturnValue(true);
    mockDispatch.mockReturnValue({
      shouldProcess: true,
      issueNumber: 42,
      repo: "test/repo",
    });

    const onPipelineTrigger = vi.fn();
    const app = createWebhookApp(makeOptions(onPipelineTrigger));
    const body = JSON.stringify(makePayload());
    const res = await app.request(makeRequest(body, "sha256=valid"));

    expect(res.status).toBe(202);
    const json = await res.json() as { status: string; issueNumber: number; repo: string };
    expect(json.status).toBe("accepted");
    expect(json.issueNumber).toBe(42);
    expect(json.repo).toBe("test/repo");
    expect(onPipelineTrigger).toHaveBeenCalledWith(42, "test/repo", undefined);
  });

  it("calls onPipelineTrigger with dependencies when present", async () => {
    mockVerify.mockReturnValue(true);
    mockDispatch.mockReturnValue({
      shouldProcess: true,
      issueNumber: 42,
      repo: "test/repo",
      dependencies: [10, 20],
    });

    const onPipelineTrigger = vi.fn();
    const app = createWebhookApp(makeOptions(onPipelineTrigger));
    const body = JSON.stringify(makePayload());
    const res = await app.request(makeRequest(body, "sha256=valid"));

    expect(res.status).toBe(202);
    expect(onPipelineTrigger).toHaveBeenCalledWith(42, "test/repo", [10, 20]);
  });

  it("returns 200 with ignored status when event should not be processed", async () => {
    mockVerify.mockReturnValue(true);
    mockDispatch.mockReturnValue({
      shouldProcess: false,
      reason: "Ignored action: opened",
    });

    const onPipelineTrigger = vi.fn();
    const app = createWebhookApp(makeOptions(onPipelineTrigger));
    const body = JSON.stringify(makePayload({ action: "opened" }));
    const res = await app.request(makeRequest(body, "sha256=valid", "issues"));

    expect(res.status).toBe(200);
    const json = await res.json() as { status: string; reason: string };
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("Ignored action: opened");
    expect(onPipelineTrigger).not.toHaveBeenCalled();
  });

  it("verifies signature with correct arguments", async () => {
    mockVerify.mockReturnValue(false);

    const app = createWebhookApp({ ...makeOptions(), webhookSecret: "my-secret" });
    const body = JSON.stringify(makePayload());
    await app.request(makeRequest(body, "sha256=sig"));

    expect(mockVerify).toHaveBeenCalledWith(body, "sha256=sig", "my-secret");
  });

  it("returns 200 when dispatch result has no issueNumber", async () => {
    mockVerify.mockReturnValue(true);
    mockDispatch.mockReturnValue({
      shouldProcess: true,
      // no issueNumber / repo
    });

    const onPipelineTrigger = vi.fn();
    const app = createWebhookApp(makeOptions(onPipelineTrigger));
    const body = JSON.stringify(makePayload());
    const res = await app.request(makeRequest(body, "sha256=valid"));

    // shouldProcess true but no issueNumber → falls to ignored
    expect(res.status).toBe(200);
    expect(onPipelineTrigger).not.toHaveBeenCalled();
  });
});

describe("startServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts server and returns close function", () => {
    const mockClose = vi.fn();
    mockServe.mockReturnValue({ close: mockClose } as unknown as ReturnType<typeof serve>);

    const app = new Hono();
    const result = startServer(app, 3000);

    expect(mockServe).toHaveBeenCalledWith({ fetch: app.fetch, port: 3000, hostname: '127.0.0.1' });
    expect(typeof result.close).toBe("function");
  });

  it("uses default port 3000 when not specified", () => {
    mockServe.mockReturnValue({ close: vi.fn() } as unknown as ReturnType<typeof serve>);

    const app = new Hono();
    startServer(app);

    expect(mockServe).toHaveBeenCalledWith({ fetch: app.fetch, port: 3000, hostname: '127.0.0.1' });
  });

  it("calls server close when close is invoked", () => {
    const mockClose = vi.fn();
    mockServe.mockReturnValue({ close: mockClose } as unknown as ReturnType<typeof serve>);

    const app = new Hono();
    const result = startServer(app, 4000);
    result.close();

    expect(mockClose).toHaveBeenCalled();
  });

  it("throws friendly error on EADDRINUSE", () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    mockServe.mockImplementation(() => { throw err; });

    const app = new Hono();

    expect(() => startServer(app, 3000)).toThrow("포트 3000가 이미 사용 중입니다");
  });

  it("rethrows non-EADDRINUSE errors", () => {
    const err = new Error("Unexpected error");
    mockServe.mockImplementation(() => { throw err; });

    const app = new Hono();

    expect(() => startServer(app, 3000)).toThrow("Unexpected error");
  });
});
