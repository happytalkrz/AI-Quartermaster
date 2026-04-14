import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CommandsConfig } from "../types/config.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

export type DetectedLanguage =
  | "nodejs"
  | "kotlin-gradle"
  | "java-gradle"
  | "java-maven"
  | "python"
  | "go"
  | "rust"
  | "unknown";

export type DetectedPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface DetectionResult {
  language: DetectedLanguage;
  commands: Partial<CommandsConfig>;
  confidence: "high" | "medium" | "low";
  fallbackReason?: string;
  packageManager?: DetectedPackageManager;
}

const SAFE_DEFAULT_COMMANDS: Partial<CommandsConfig> = {
  test: "echo skip",
};

function parsePackageJson(projectPath: string): Record<string, string> {
  const pkgPath = join(projectPath, "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch (err: unknown) {
    getLogger().debug(`package.json 파싱 실패 (무시): ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

interface PackageManagerDetection {
  packageManager: DetectedPackageManager;
  confidence: "high" | "medium";
  fallbackReason?: string;
}

function detectPackageManager(projectPath: string): PackageManagerDetection {
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) {
    return { packageManager: "pnpm", confidence: "high" };
  }
  if (existsSync(join(projectPath, "yarn.lock"))) {
    return { packageManager: "yarn", confidence: "high" };
  }
  if (existsSync(join(projectPath, "bun.lockb"))) {
    return { packageManager: "bun", confidence: "high" };
  }
  return {
    packageManager: "npm",
    confidence: "medium",
    fallbackReason: "lockfile 없음 — npm fallback",
  };
}

function buildNodeCommands(
  scripts: Record<string, string>,
  projectPath: string,
  pm: DetectedPackageManager,
): Partial<CommandsConfig> {
  const run = (script: string): string => {
    if (pm === "yarn") return `yarn ${script}`;
    return `${pm} run ${script}`;
  };

  const commands: Partial<CommandsConfig> = {};

  if (pm === "bun") {
    commands.test = scripts["test"] ? "bun test" : "echo skip";
  } else if (pm === "yarn") {
    commands.test = scripts["test"] ? "yarn test" : "echo skip";
  } else {
    commands.test = scripts["test"] ? `${pm} test` : "echo skip";
  }

  if (scripts["lint"]) {
    commands.lint = run("lint");
  }

  if (scripts["build"]) {
    commands.build = run("build");
  }

  if (scripts["typecheck"]) {
    commands.typecheck = run("typecheck");
  } else if (scripts["type-check"]) {
    commands.typecheck = run("type-check");
  } else if (existsSync(join(projectPath, "tsconfig.json"))) {
    commands.typecheck = "npx tsc --noEmit";
  }

  return commands;
}

function detectNodeCommands(projectPath: string): {
  commands: Partial<CommandsConfig>;
  pmDetection: PackageManagerDetection;
} {
  const scripts = parsePackageJson(projectPath);
  const pmDetection = detectPackageManager(projectPath);
  const commands = buildNodeCommands(scripts, projectPath, pmDetection.packageManager);
  return { commands, pmDetection };
}

export function detectProjectCommands(projectPath: string): DetectionResult {
  const logger = getLogger();

  try {
    if (existsSync(join(projectPath, "package.json"))) {
      logger.debug(`[project-detector] Node.js 프로젝트 감지: ${projectPath}`);
      const { commands, pmDetection } = detectNodeCommands(projectPath);
      return {
        language: "nodejs",
        commands,
        confidence: pmDetection.confidence,
        packageManager: pmDetection.packageManager,
        ...(pmDetection.fallbackReason ? { fallbackReason: pmDetection.fallbackReason } : {}),
      };
    }

    if (existsSync(join(projectPath, "build.gradle.kts"))) {
      logger.debug(`[project-detector] Kotlin-Gradle 프로젝트 감지: ${projectPath}`);
      const hasWrapper = existsSync(join(projectPath, "gradlew"));
      return {
        language: "kotlin-gradle",
        commands: hasWrapper
          ? { test: "./gradlew test", build: "./gradlew build", typecheck: "echo skip" }
          : { test: "gradle test", build: "gradle build", typecheck: "echo skip" },
        confidence: hasWrapper ? "high" : "medium",
        ...(hasWrapper ? {} : { fallbackReason: "gradlew not found" }),
      };
    }

    if (existsSync(join(projectPath, "build.gradle"))) {
      logger.debug(`[project-detector] Java-Gradle 프로젝트 감지: ${projectPath}`);
      const hasWrapper = existsSync(join(projectPath, "gradlew"));
      return {
        language: "java-gradle",
        commands: hasWrapper
          ? { test: "./gradlew test", build: "./gradlew build", typecheck: "echo skip" }
          : { test: "gradle test", build: "gradle build", typecheck: "echo skip" },
        confidence: hasWrapper ? "high" : "medium",
        ...(hasWrapper ? {} : { fallbackReason: "gradlew not found" }),
      };
    }

    if (existsSync(join(projectPath, "pom.xml"))) {
      logger.debug(`[project-detector] Java-Maven 프로젝트 감지: ${projectPath}`);
      return {
        language: "java-maven",
        commands: { test: "mvn test", build: "mvn package -DskipTests", typecheck: "echo skip" },
        confidence: "high",
      };
    }

    if (
      existsSync(join(projectPath, "pyproject.toml")) ||
      existsSync(join(projectPath, "setup.py")) ||
      existsSync(join(projectPath, "requirements.txt"))
    ) {
      logger.debug(`[project-detector] Python 프로젝트 감지: ${projectPath}`);
      return {
        language: "python",
        commands: { test: "python -m pytest", lint: "ruff check .", typecheck: "echo skip" },
        confidence: "high",
      };
    }

    if (existsSync(join(projectPath, "go.mod"))) {
      logger.debug(`[project-detector] Go 프로젝트 감지: ${projectPath}`);
      return {
        language: "go",
        commands: { test: "go test ./...", build: "go build ./...", typecheck: "go vet ./..." },
        confidence: "high",
      };
    }

    if (existsSync(join(projectPath, "Cargo.toml"))) {
      logger.debug(`[project-detector] Rust 프로젝트 감지: ${projectPath}`);
      return {
        language: "rust",
        commands: { test: "cargo test", build: "cargo build", lint: "cargo clippy", typecheck: "echo skip" },
        confidence: "high",
      };
    }

    logger.debug(`[project-detector] 언어 감지 불가: ${projectPath}`);
    return { language: "unknown", commands: SAFE_DEFAULT_COMMANDS, confidence: "low", fallbackReason: "no project marker found" };
  } catch (err: unknown) {
    logger.warn(`[project-detector] 감지 중 오류: ${getErrorMessage(err)}`);
    return { language: "unknown", commands: SAFE_DEFAULT_COMMANDS, confidence: "low", fallbackReason: "no project marker found" };
  }
}

export async function detectBaseBranch(projectPath: string): Promise<string> {
  const logger = getLogger();

  try {
    const { runCli } = await import("../utils/cli-runner.js");

    try {
      const result = await runCli("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
        cwd: projectPath,
        timeout: 5000,
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        const branch = result.stdout.trim().split("/").pop();
        if (branch) return branch;
      }
    } catch (err: unknown) {
      // 다음 방법으로 폴백
      getLogger().debug(`git symbolic-ref 감지 실패, 다음 방법으로 폴백 (무시): ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const result = await runCli("git", ["config", "init.defaultBranch"], {
        cwd: projectPath,
        timeout: 5000,
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // 폴백
    }

    return "main";
  } catch (err: unknown) {
    logger.warn(`[project-detector] baseBranch 감지 실패: ${getErrorMessage(err)}`);
    return "main";
  }
}
