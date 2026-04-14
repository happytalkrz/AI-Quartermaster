import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkClaudeQuota } from "../../src/claude/quota-checker.js";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import type { ClaudeCliConfig } from "../../src/types/config.js";

vi.mock("child_process");
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockSpawn = vi.mocked(spawn);

const BASE_CONFIG: ClaudeCliConfig = {
  path: "claude",
  model: "sonnet",
  models: { plan: "claude-opus-4-5", phase: "claude-sonnet-4-5", review: "claude-haiku-4-5", fallback: "claude-sonnet-4-5" },
  maxTurns: 10,
  timeout: 30000,
  additionalArgs: [],
};

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeMockChild(): MockChild {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      // Simulate process termination on kill
      setImmediate(() => (child as EventEmitter).emit("close", null));
    }),
  }) as MockChild;
  return child;
}

describe("checkClaudeQuota", () => {
  let mockChildren: MockChild[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockChildren = [];
    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      return child as ReturnType<typeof spawn>;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("정상 응답 시 ok: true를 반환한다", async () => {
    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from('{"type":"result","result":"pong","is_error":false}\n'));
        child.emit("close", 0);
      });
      return child as ReturnType<typeof spawn>;
    });

    const result = await checkClaudeQuota(BASE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("All models available");
    expect(result.profileVerified).toBe(true);
    expect(result.lastChecked).toBeGreaterThan(0);
  });

  it("QUOTA_EXHAUSTED 에러 시 해당 모델 ok: false를 반환한다", async () => {
    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      setImmediate(() => {
        child.stderr.emit("data", Buffer.from("Error: You've hit your limit · resets Apr 15"));
        child.emit("close", 1);
      });
      return child as ReturnType<typeof spawn>;
    });

    const result = await checkClaudeQuota(BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("hit your limit");
    // All three roles fail (same model cached)
    for (const role of ["plan", "phase", "review"]) {
      expect(result.models[role]).toBeDefined();
    }
  });

  it("인증 실패 시 ok: false를 반환한다", async () => {
    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      setImmediate(() => {
        child.stderr.emit("data", Buffer.from("Error: Unauthorized — please login first"));
        child.emit("close", 1);
      });
      return child as ReturnType<typeof spawn>;
    });

    const result = await checkClaudeQuota(BASE_CONFIG);

    expect(result.ok).toBe(false);
    const messages = Object.values(result.models).map((m) => m.message);
    expect(messages.some((m) => m.toLowerCase().includes("auth") || m.toLowerCase().includes("login") || m.toLowerCase().includes("unauthorized"))).toBe(true);
  });

  it("타임아웃 시 graceful하게 처리한다", async () => {
    vi.useFakeTimers();

    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      // Do not emit anything — let it time out
      child.kill = vi.fn(() => {
        setImmediate(() => child.emit("close", null));
      });
      return child as ReturnType<typeof spawn>;
    });

    const resultPromise = checkClaudeQuota(BASE_CONFIG);

    // Advance past 15s timeout for all three model checks
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    const messages = Object.values(result.models).map((m) => m.message);
    expect(messages.every((m) => m.includes("Timeout"))).toBe(true);

    vi.useRealTimers();
  });

  it("동일 모델을 여러 role이 공유할 때 spawn을 한 번만 호출한다", async () => {
    const sharedModel = "claude-sonnet-4-5";
    const config: ClaudeCliConfig = {
      ...BASE_CONFIG,
      models: { plan: sharedModel, phase: sharedModel, review: sharedModel, fallback: sharedModel },
    };

    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from('{"type":"result","result":"ok","is_error":false}\n'));
        child.emit("close", 0);
      });
      return child as ReturnType<typeof spawn>;
    });

    const result = await checkClaudeQuota(config);

    // Cache should prevent duplicate calls for the same model
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.models["plan"].ok).toBe(true);
    expect(result.models["phase"].ok).toBe(true);
    expect(result.models["review"].ok).toBe(true);
  });

  it("CLAUDE_CONFIG_DIR가 설정되면 spawn 환경에 포함된다", async () => {
    const originalEnv = process.env["CLAUDE_CONFIG_DIR"];
    process.env["CLAUDE_CONFIG_DIR"] = "/custom/claude/config";

    mockSpawn.mockImplementation((_cmd, _args, options) => {
      const child = makeMockChild();
      mockChildren.push(child);
      // Verify the env passed to spawn contains CLAUDE_CONFIG_DIR
      expect((options as { env?: NodeJS.ProcessEnv }).env?.["CLAUDE_CONFIG_DIR"]).toBe("/custom/claude/config");
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from('{"type":"result","result":"ok","is_error":false}\n'));
        child.emit("close", 0);
      });
      return child as ReturnType<typeof spawn>;
    });

    await checkClaudeQuota(BASE_CONFIG);

    if (originalEnv === undefined) {
      delete process.env["CLAUDE_CONFIG_DIR"];
    } else {
      process.env["CLAUDE_CONFIG_DIR"] = originalEnv;
    }
  });

  it("stdout result event is_error: true 시 ok: false를 반환한다", async () => {
    mockSpawn.mockImplementation(() => {
      const child = makeMockChild();
      mockChildren.push(child);
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from('{"type":"result","result":"Claude returned an error","is_error":true}\n'));
        child.emit("close", 0);
      });
      return child as ReturnType<typeof spawn>;
    });

    const result = await checkClaudeQuota(BASE_CONFIG);

    expect(result.ok).toBe(false);
    const messages = Object.values(result.models).map((m) => m.message);
    expect(messages.some((m) => m.includes("error"))).toBe(true);
  });
});
