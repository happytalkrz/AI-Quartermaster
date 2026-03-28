import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  writePidFile,
  readPidFile,
  isProcessRunning,
  cleanupStalePid,
  removePidFile,
} from "../../src/server/pid-manager.js";

let tmpDir: string;
let pidPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(`${tmpdir()}/pid-manager-test-`);
  pidPath = join(tmpDir, "test.pid");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("writePidFile", () => {
  it("writes current PID to file", () => {
    writePidFile(pidPath);
    const content = readPidFile(pidPath);
    expect(content).toBe(process.pid);
  });

  it("creates parent directories if they do not exist", () => {
    const nestedPath = join(tmpDir, "a", "b", "c", "server.pid");
    writePidFile(nestedPath);
    expect(readPidFile(nestedPath)).toBe(process.pid);
  });
});

describe("readPidFile", () => {
  it("returns null when file does not exist", () => {
    expect(readPidFile(join(tmpDir, "nonexistent.pid"))).toBeNull();
  });

  it("returns null for non-numeric content", () => {
    writeFileSync(pidPath, "not-a-number");
    expect(readPidFile(pidPath)).toBeNull();
  });

  it("returns the parsed integer PID", () => {
    writeFileSync(pidPath, "12345");
    expect(readPidFile(pidPath)).toBe(12345);
  });

  it("trims whitespace before parsing", () => {
    writeFileSync(pidPath, "  99  \n");
    expect(readPidFile(pidPath)).toBe(99);
  });
});

describe("isProcessRunning", () => {
  it("returns true for the current process PID", () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it("returns false for a PID that does not exist", () => {
    expect(isProcessRunning(99999999)).toBe(false);
  });
});

describe("cleanupStalePid", () => {
  it("returns true when no PID file exists", () => {
    expect(cleanupStalePid(pidPath)).toBe(true);
  });

  it("returns false when the process in PID file is still running", () => {
    writePidFile(pidPath);
    expect(cleanupStalePid(pidPath)).toBe(false);
  });

  it("removes stale PID file and returns true when process is dead", () => {
    writeFileSync(pidPath, "99999999");
    const result = cleanupStalePid(pidPath);
    expect(result).toBe(true);
    expect(readPidFile(pidPath)).toBeNull();
  });
});

describe("removePidFile", () => {
  it("removes an existing PID file", () => {
    writePidFile(pidPath);
    removePidFile(pidPath);
    expect(readPidFile(pidPath)).toBeNull();
  });

  it("does not throw when file does not exist", () => {
    expect(() => removePidFile(join(tmpDir, "ghost.pid"))).not.toThrow();
  });
});
