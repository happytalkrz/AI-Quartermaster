import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "http";
import {
  writePidFile,
  readPidFile,
  isProcessRunning,
  cleanupStalePid,
  removePidFile,
  findProcessByPort,
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

describe("findProcessByPort", () => {
  it("returns null for a port that is not in use", () => {
    // Use a high port number that is unlikely to be in use
    const unusedPort = 65432;
    expect(findProcessByPort(unusedPort)).toBeNull();
  });

  it("returns null for invalid port numbers", () => {
    expect(findProcessByPort(-1)).toBeNull();
    expect(findProcessByPort(0)).toBeNull();
    expect(findProcessByPort(99999)).toBeNull();
  });

  it("does not throw for edge cases", () => {
    expect(() => findProcessByPort(80)).not.toThrow();
    expect(() => findProcessByPort(443)).not.toThrow();
    expect(() => findProcessByPort(3000)).not.toThrow();
  });

  it("returns the correct PID for a process listening on a port", async () => {
    // Create a test HTTP server
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("test server");
    });

    // Find an available port by letting the system assign one
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Failed to get server address");
    }

    const port = address.port;

    try {
      // Find the process using this port
      const foundPid = findProcessByPort(port);

      // The found PID should be the current process PID (since this test is running the server)
      expect(foundPid).toBe(process.pid);
    } finally {
      // Clean up the server
      server.close();

      // Wait a bit for the port to be released
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  it("returns null when lsof command fails or port is freed", async () => {
    // Test port that was in use but is now free
    const server = createServer();

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Failed to get server address");
    }

    const port = address.port;

    // Close the server first
    server.close();

    // Wait for port to be released
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now the port should be free and findProcessByPort should return null
    expect(findProcessByPort(port)).toBeNull();
  });
});
