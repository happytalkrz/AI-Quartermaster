import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { SafetyViolationError } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * Checks if changed files are within the scope of a Phase's targetFiles.
 * Logs a warning for out-of-scope files — does NOT throw.
 */
export function checkFileScope(
  changedFiles: string[],
  targetFiles: string[]
): void {
  if (targetFiles.length === 0) {
    return;
  }

  const outOfScope = changedFiles.filter(
    (file) => !targetFiles.some((target) => file === target || file.startsWith(target))
  );

  if (outOfScope.length > 0) {
    logger.warn(
      `[ScopeGuard] Phase 범위 외 파일 변경 감지 (${outOfScope.length}개): ${outOfScope.join(", ")}`
    );
  }
}

/**
 * Checks if any .js files being created duplicate an existing .ts/.tsx file.
 * Throws SafetyViolationError if a .js file conflicts with an existing .ts/.tsx counterpart.
 */
export function checkDuplicateExtension(
  changedFiles: string[],
  cwd: string
): void {
  const violations: string[] = [];

  for (const file of changedFiles) {
    const ext = extname(file);
    if (ext !== ".js") {
      continue;
    }

    const base = basename(file, ".js");
    const dir = file.slice(0, file.length - basename(file).length);

    for (const tsExt of [".ts", ".tsx"]) {
      const tsFile = join(cwd, dir, base + tsExt);
      if (existsSync(tsFile)) {
        violations.push(`${file} → ${dir}${base}${tsExt} 가 이미 존재합니다`);
        break;
      }
    }
  }

  if (violations.length > 0) {
    throw new SafetyViolationError(
      "ScopeGuard",
      `.js 파일이 기존 .ts/.tsx와 중복됩니다:\n${violations.join("\n")}`,
      { violations }
    );
  }
}
