import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";

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
      const { readFileSync: readFs } = require("fs");
      const stat = readFs(`/proc/${pid}/status`, "utf-8");
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
