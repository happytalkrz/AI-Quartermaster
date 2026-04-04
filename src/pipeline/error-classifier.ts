import type { ErrorCategory } from "../types/pipeline.js";

export function classifyError(error: string): ErrorCategory {
  const lower = error.toLowerCase();
  if (lower.includes("ts2") || lower.includes("ts1") || lower.includes("type error") || lower.includes("cannot find name") || (lower.includes("property") && lower.includes("does not exist"))) {
    return "TS_ERROR";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("x-ratelimit") || lower.includes("429")) {
    return "RATE_LIMIT";
  }
  if (lower.includes("prompt is too long") || lower.includes("prompt too long") || lower.includes("context length") || lower.includes("token limit")) {
    return "PROMPT_TOO_LONG";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("sigterm")) {
    return "TIMEOUT";
  }
  if (lower.includes("enoent") || lower.includes("spawn") || lower.includes("cli_crash") || lower.includes("exited with code")) {
    return "CLI_CRASH";
  }
  if (lower.includes("tests failed") || lower.includes("lint") || lower.includes("verification")) {
    return "VERIFICATION_FAILED";
  }
  if (lower.includes("safety") || lower.includes("sensitive") || lower.includes("violation")) {
    return "SAFETY_VIOLATION";
  }
  return "UNKNOWN";
}
