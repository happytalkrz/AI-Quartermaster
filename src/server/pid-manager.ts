import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { execSync } from "child_process";

export function writePidFile(pidPath: string): void {
  const dir = dirname(pidPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(pidPath, String(process.pid), "utf-8");
}

export function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  try {
    const content = readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // Check for zombie process on Linux
    try {
      const stat = readFileSync(`/proc/${pid}/status`, "utf-8");
      if (stat.includes("State:\tZ")) return false; // zombie
    } catch {
      // /proc not available (non-Linux) — trust kill(0)
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * If PID file exists but process is dead, remove it and return true.
 * If process is alive, return false (server already running).
 * If no PID file, return true (safe to start).
 */
export function cleanupStalePid(pidPath: string): boolean {
  const pid = readPidFile(pidPath);
  if (pid === null) return true;
  if (isProcessRunning(pid)) return false;
  removePidFile(pidPath);
  return true;
}

export function removePidFile(pidPath: string): void {
  try {
    if (existsSync(pidPath)) {
      unlinkSync(pidPath);
    }
  } catch {
    // 무시 — 프로세스 종료 중에는 실패해도 괜찮다
  }
}

/**
 * Find process PID that is listening on the specified port using lsof.
 * Returns the PID if found and running, null otherwise.
 */
export function findProcessByPort(port: number): number | null {
  try {
    // Execute lsof -ti :PORT to find process listening on port
    const output = execSync(`lsof -ti :${port}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    // Get first PID from output (equivalent to head -n1)
    const lines = output.trim().split("\n");
    if (lines.length === 0 || lines[0] === "") {
      return null;
    }

    const pid = parseInt(lines[0], 10);
    if (isNaN(pid)) {
      return null;
    }

    // Verify the process is actually running
    if (isProcessRunning(pid)) {
      return pid;
    }

    return null;
  } catch {
    // lsof command failed (port not in use, permission denied, etc.)
    return null;
  }
}
