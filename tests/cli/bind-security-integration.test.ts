import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");
const TSX = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const CLI_PATH = join(PROJECT_ROOT, "src/cli.ts");

function isRunningInWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const release = readFileSync("/proc/sys/kernel/osrelease", "utf-8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

function createTestAqRoot(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "aqm-bind-test-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(
    join(dir, "config.yml"),
    [
      "projects:",
      "  - repo: test-org/test-repo",
      "    path: /tmp",
      "    baseBranch: main",
    ].join("\n") + "\n"
  );
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true });
      } catch {
        /* ignore cleanup errors */
      }
    },
  };
}

function makeEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  return env;
}

function spawnCliAndWaitExit(
  args: string[],
  env: Record<string, string>,
  timeoutMs = 10000
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(TSX, [CLI_PATH, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ exitCode: code, stdout, stderr });
    });
  });
}

function spawnCliUntilPattern(
  args: string[],
  env: Record<string, string>,
  pattern: string,
  timeoutMs = 20000
): Promise<{ found: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((res) => {
    const child = spawn(TSX, [CLI_PATH, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = () => {
      if (!done) {
        done = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    };

    const checkPattern = () => {
      if ((stdout + stderr).includes(pattern)) finish();
    };

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      checkPattern();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      checkPattern();
    });

    const timer = setTimeout(finish, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      res({
        found: (stdout + stderr).includes(pattern),
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}

describe("bind security CLI integration", () => {
  it.skipIf(isRunningInWSL())(
    "비-WSL + 0.0.0.0 + API key 없음 → exit 1 및 보안 오류 출력",
    async () => {
      const { dir, cleanup } = createTestAqRoot();
      try {
        const result = await spawnCliAndWaitExit(
          [
            "start",
            "--host", "0.0.0.0",
            "--mode", "polling",
            "--config", join(dir, "config.yml"),
          ],
          makeEnv({
            WSL_DISTRO_NAME: undefined,
            WSL_INTEROP: undefined,
            DASHBOARD_API_KEY: undefined,
            DASHBOARD_ALLOW_INSECURE: undefined,
          }),
          10000
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("보안 오류");
      } finally {
        cleanup();
      }
    },
    15000
  );

  it(
    "127.0.0.1 → 서버 listening 확인 후 SIGTERM 정리",
    async () => {
      const { dir, cleanup } = createTestAqRoot();
      try {
        const result = await spawnCliUntilPattern(
          [
            "start",
            "--host", "127.0.0.1",
            "--port", "39201",
            "--mode", "polling",
            "--config", join(dir, "config.yml"),
          ],
          makeEnv({ DASHBOARD_API_KEY: undefined }),
          "listening",
          20000
        );
        expect(result.found).toBe(true);
      } finally {
        cleanup();
      }
    },
    30000
  );

  it(
    "0.0.0.0 + DASHBOARD_API_KEY 설정 → 서버 listening 확인 후 SIGTERM 정리",
    async () => {
      const { dir, cleanup } = createTestAqRoot();
      try {
        const result = await spawnCliUntilPattern(
          [
            "start",
            "--host", "0.0.0.0",
            "--port", "39202",
            "--mode", "polling",
            "--config", join(dir, "config.yml"),
          ],
          makeEnv({
            DASHBOARD_API_KEY: "test-key",
            WSL_DISTRO_NAME: undefined,
            WSL_INTEROP: undefined,
          }),
          "listening",
          20000
        );
        expect(result.found).toBe(true);
      } finally {
        cleanup();
      }
    },
    30000
  );

  it(
    "DASHBOARD_ALLOW_INSECURE=true + 0.0.0.0 + API key 없음 → 서버 listening + read-only 경고 출력",
    async () => {
      const { dir, cleanup } = createTestAqRoot();
      try {
        const result = await spawnCliUntilPattern(
          [
            "start",
            "--host", "0.0.0.0",
            "--port", "39203",
            "--mode", "polling",
            "--config", join(dir, "config.yml"),
          ],
          makeEnv({
            DASHBOARD_API_KEY: undefined,
            DASHBOARD_ALLOW_INSECURE: "true",
            WSL_DISTRO_NAME: undefined,
            WSL_INTEROP: undefined,
          }),
          "listening",
          20000
        );
        expect(result.found).toBe(true);
        expect(result.stderr).toContain("insecure 모드");
      } finally {
        cleanup();
      }
    },
    30000
  );
});
