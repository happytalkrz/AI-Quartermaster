import { minimatch } from "minimatch";
import { SafetyViolationError } from "../types/errors.js";

export interface RuleSet {
  allow: string[];
  deny: string[];
  /** "allow-first": allow 매칭 시 통과, 이후 deny 검사. "deny-first": deny 매칭 시 즉시 차단. default: "deny-first" */
  strategy?: "allow-first" | "deny-first";
}

/**
 * Checks a file path against allow/deny glob rules.
 *
 * deny-first (default): deny 패턴 매칭 → 차단. allow 패턴으로 예외 허용 없음.
 * allow-first: allow 패턴 매칭 → 통과. allow에 없으면 deny 패턴 검사.
 *
 * Throws SafetyViolationError if the path is denied.
 */
export function checkPathAgainstRules(path: string, rules: RuleSet): void {
  const strategy = rules.strategy ?? "deny-first";
  const opts = { dot: true };

  if (strategy === "allow-first") {
    const allowed = rules.allow.some((pattern) => minimatch(path, pattern, opts));
    if (allowed) return;

    const denied = rules.deny.some((pattern) => minimatch(path, pattern, opts));
    if (denied) {
      throw new SafetyViolationError(
        "RuleEngine",
        `Path "${path}" is denied by rule (strategy: allow-first)`,
        { path, matchedDenyPattern: rules.deny.find((p) => minimatch(path, p, opts)) }
      );
    }
  } else {
    // deny-first
    const matchedDeny = rules.deny.find((pattern) => minimatch(path, pattern, opts));
    if (matchedDeny) {
      const allowOverride = rules.allow.some((pattern) => minimatch(path, pattern, opts));
      if (!allowOverride) {
        throw new SafetyViolationError(
          "RuleEngine",
          `Path "${path}" is denied by rule "${matchedDeny}" (strategy: deny-first)`,
          { path, matchedDenyPattern: matchedDeny }
        );
      }
    }
  }
}

/**
 * Checks multiple file paths against allow/deny glob rules.
 * Collects all violations and throws a single SafetyViolationError.
 */
export function checkPathsAgainstRules(paths: string[], rules: RuleSet): void {
  const violations: string[] = [];

  for (const path of paths) {
    try {
      checkPathAgainstRules(path, rules);
    } catch (err: unknown) {
      if (err instanceof SafetyViolationError) {
        violations.push(err.message);
      } else {
        throw err;
      }
    }
  }

  if (violations.length > 0) {
    throw new SafetyViolationError(
      "RuleEngine",
      `Rule violations detected:\n${violations.join("\n")}`,
      { violations }
    );
  }
}
