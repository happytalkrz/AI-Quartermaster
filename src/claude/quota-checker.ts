import { spawn } from "child_process";
import type { ClaudeCliConfig, QuotaStatus } from "../types/config.js";
import { classifyError } from "../pipeline/errors/error-classifier.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

export type QuotaCheckResult = QuotaStatus;

const QUOTA_CHECK_TIMEOUT_MS = 15_000;
const PING_PROMPT = "ping";

function buildClaudeEnv(): NodeJS.ProcessEnv {
  const ALLOWED_KEYS = [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL",
    "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE",
    "NODE_ENV", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
    "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CONFIG_DIR",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

async function checkModelQuota(
  claudePath: string,
  model: string,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: { ok: boolean; message: string }) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const args = [
      "-p", PING_PROMPT,
      "--model", model,
      "--max-turns", "1",
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", "bypassPermissions",
    ];

    let stderr = "";
    let streamBuffer = "";
    let stdoutResultFound = false;

    const child = spawn(claudePath, args, {
      env: buildClaudeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      done({ ok: false, message: "Timeout after 15s" });
    }, QUOTA_CHECK_TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      streamBuffer += data.toString();
      let newlineIdx: number;
      while ((newlineIdx = streamBuffer.indexOf("\n")) !== -1) {
        const line = streamBuffer.slice(0, newlineIdx).trim();
        streamBuffer = streamBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line) as {
            type?: string;
            result?: string;
            is_error?: boolean;
          };
          if (event.type === "result") {
            stdoutResultFound = true;
            clearTimeout(timeoutId);
            if (event.is_error) {
              done({ ok: false, message: event.result ?? "Claude returned an error" });
            } else {
              done({ ok: true, message: "ok" });
            }
          }
        } catch (_err: unknown) {
          // not valid JSON — skip
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      const category = classifyError(chunk);
      if (category === "QUOTA_EXHAUSTED" || category === "RATE_LIMIT") {
        clearTimeout(timeoutId);
        child.kill("SIGTERM");
        done({ ok: false, message: chunk.trim() });
      }
    });

    child.on("close", () => {
      clearTimeout(timeoutId);
      if (!stdoutResultFound) {
        if (stderr) {
          const category = classifyError(stderr);
          if (category === "QUOTA_EXHAUSTED" || category === "RATE_LIMIT") {
            done({ ok: false, message: stderr.trim() });
            return;
          }
          const lower = stderr.toLowerCase();
          if (lower.includes("auth") || lower.includes("login") || lower.includes("unauthorized")) {
            done({ ok: false, message: `Authentication error: ${stderr.trim()}` });
            return;
          }
        }
        done({ ok: false, message: stderr.trim() || "No result received from Claude CLI" });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeoutId);
      done({ ok: false, message: getErrorMessage(err) });
    });
  });
}

export async function checkClaudeQuota(config: ClaudeCliConfig): Promise<QuotaCheckResult> {
  const logger = getLogger();
  const { path: claudePath, models } = config;

  const roles: Array<[string, string]> = [
    ["plan", models.plan],
    ["phase", models.phase],
    ["review", models.review],
  ];

  // Cache by model value to avoid redundant CLI calls for the same model
  const modelCache = new Map<string, { ok: boolean; message: string }>();
  const modelResults: Record<string, { ok: boolean; message: string }> = {};
  let profileVerified = false;
  let overallOk = true;
  const failMessages: string[] = [];

  for (const [role, model] of roles) {
    logger.debug(`[quota-checker] Checking ${role} model: ${model}`);
    let result: { ok: boolean; message: string };
    if (modelCache.has(model)) {
      result = modelCache.get(model)!;
    } else {
      try {
        result = await checkModelQuota(claudePath, model);
      } catch (err: unknown) {
        result = { ok: false, message: getErrorMessage(err) };
      }
      modelCache.set(model, result);
    }
    modelResults[role] = result;
    if (result.ok) {
      profileVerified = true;
    } else {
      overallOk = false;
      failMessages.push(`${role}(${model}): ${result.message}`);
    }
  }

  return {
    ok: overallOk,
    message: overallOk ? "All models available" : failMessages.join("; "),
    models: modelResults,
    profileVerified,
    lastChecked: Date.now(),
  };
}
