import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLogger, setGlobalLogLevel } from "../../src/utils/logger.js";

describe("getLogger", () => {
  beforeEach(() => {
    setGlobalLogLevel("debug");
  });

  afterEach(() => {
    setGlobalLogLevel("info");
    vi.restoreAllMocks();
  });

  it("should call console.log for debug messages when level is debug", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("test debug message");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("[DEBUG]");
    expect(spy.mock.calls[0][0]).toContain("test debug message");
  });

  it("should call console.log for info messages", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.info("test info message");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("[INFO]");
    expect(spy.mock.calls[0][0]).toContain("test info message");
  });

  it("should call console.warn for warn messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = getLogger();

    logger.warn("test warn message");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("[WARN]");
    expect(spy.mock.calls[0][0]).toContain("test warn message");
  });

  it("should call console.error for error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = getLogger();

    logger.error("test error message");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("[ERROR]");
    expect(spy.mock.calls[0][0]).toContain("test error message");
  });
});

describe("setGlobalLogLevel + filtering", () => {
  afterEach(() => {
    setGlobalLogLevel("info");
    vi.restoreAllMocks();
  });

  it("should suppress debug logs when level is info", () => {
    setGlobalLogLevel("info");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("should be suppressed");

    expect(spy).not.toHaveBeenCalled();
  });

  it("should suppress debug and info logs when level is warn", () => {
    setGlobalLogLevel("warn");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("suppressed debug");
    logger.info("suppressed info");
    logger.warn("visible warn");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("should only allow error logs when level is error", () => {
    setGlobalLogLevel("error");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("suppressed");
    logger.info("suppressed");
    logger.warn("suppressed");
    logger.error("visible error");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("should allow all logs when level is debug", () => {
    setGlobalLogLevel("debug");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(logSpy).toHaveBeenCalledTimes(2); // debug + info both use console.log
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sensitive info masking in log args", () => {
  beforeEach(() => {
    setGlobalLogLevel("debug");
  });

  afterEach(() => {
    setGlobalLogLevel("info");
    vi.restoreAllMocks();
  });

  it("should mask token fields in logged objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.info("request context", { accessToken: "ghp_secret123", user: "alice" });

    expect(spy).toHaveBeenCalledOnce();
    const maskedArg = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(maskedArg.accessToken).toBe("********");
    expect(maskedArg.user).toBe("alice");
  });

  it("should mask password fields in logged objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.info("db config", { password: "super_secret", host: "localhost" });

    const maskedArg = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(maskedArg.password).toBe("********");
    expect(maskedArg.host).toBe("localhost");
  });

  it("should mask secret fields in logged objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.info("webhook", { GITHUB_WEBHOOK_SECRET: "wh_secret_xyz", event: "push" });

    const maskedArg = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(maskedArg.GITHUB_WEBHOOK_SECRET).toBe("********");
    expect(maskedArg.event).toBe("push");
  });

  it("should mask apiKey fields in logged objects", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.debug("config", { apiKey: "sk-abcdef", model: "gpt-4" });

    const maskedArg = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(maskedArg.apiKey).toBe("********");
    expect(maskedArg.model).toBe("gpt-4");
  });

  it("should mask sensitive fields in nested objects", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = getLogger();

    logger.error("error context", {
      config: { token: "bearer_secret", timeout: 5000 },
      user: "alice",
    });

    const maskedArg = spy.mock.calls[0][1] as { config: Record<string, unknown>; user: string };
    expect(maskedArg.config.token).toBe("********");
    expect(maskedArg.config.timeout).toBe(5000);
    expect(maskedArg.user).toBe("alice");
  });

  it("should not modify the original object passed as arg", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();
    const original = { token: "real_token", data: "info" };

    logger.info("message", original);

    // The logged arg is masked
    const maskedArg = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(maskedArg.token).toBe("********");
    // But the original is unchanged
    expect(original.token).toBe("real_token");
  });

  it("should pass through non-sensitive primitive args unchanged", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = getLogger();

    logger.info("message", "plain string", 42, true);

    expect(spy.mock.calls[0][1]).toBe("plain string");
    expect(spy.mock.calls[0][2]).toBe(42);
    expect(spy.mock.calls[0][3]).toBe(true);
  });

  it("should mask multiple sensitive args in a single log call", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = getLogger();

    logger.warn("multiple args", { token: "t1" }, { password: "p1" });

    const arg1 = spy.mock.calls[0][1] as Record<string, unknown>;
    const arg2 = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(arg1.token).toBe("********");
    expect(arg2.password).toBe("********");
  });
});
