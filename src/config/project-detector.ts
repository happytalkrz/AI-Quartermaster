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

export interface DetectionResult {
  language: DetectedLanguage;
  commands: Partial<CommandsConfig>;
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
  } catch {
    return {};
  }
}

function detectNodeCommands(projectPath: string): Partial<CommandsConfig> {
  const scripts = parsePackageJson(projectPath);
  const commands: Partial<CommandsConfig> = {};

  commands.test = scripts["test"] ? "npm test" : "echo skip";

  if (scripts["lint"]) {
    commands.lint = "npm run lint";
  }

  if (scripts["build"]) {
    commands.build = "npm run build";
  }

  if (scripts["typecheck"]) {
    commands.typecheck = "npm run typecheck";
  } else if (scripts["type-check"]) {
    commands.typecheck = "npm run type-check";
  } else if (existsSync(join(projectPath, "tsconfig.json"))) {
    commands.typecheck = "npx tsc --noEmit";
  }

  return commands;
}

export function detectProjectCommands(projectPath: string): DetectionResult {
  const logger = getLogger();

  try {
    if (existsSync(join(projectPath, "package.json"))) {
      logger.debug(`[project-detector] Node.js 프로젝트 감지: ${projectPath}`);
      return { language: "nodejs", commands: detectNodeCommands(projectPath) };
    }

    if (existsSync(join(projectPath, "build.gradle.kts"))) {
      logger.debug(`[project-detector] Kotlin-Gradle 프로젝트 감지: ${projectPath}`);
      return {
        language: "kotlin-gradle",
        commands: { test: "./gradlew test", build: "./gradlew build", typecheck: "echo skip" },
      };
    }

    if (existsSync(join(projectPath, "build.gradle"))) {
      logger.debug(`[project-detector] Java-Gradle 프로젝트 감지: ${projectPath}`);
      return {
        language: "java-gradle",
        commands: { test: "./gradlew test", build: "./gradlew build", typecheck: "echo skip" },
      };
    }

    if (existsSync(join(projectPath, "pom.xml"))) {
      logger.debug(`[project-detector] Java-Maven 프로젝트 감지: ${projectPath}`);
      return {
        language: "java-maven",
        commands: { test: "mvn test", build: "mvn package -DskipTests", typecheck: "echo skip" },
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
      };
    }

    if (existsSync(join(projectPath, "go.mod"))) {
      logger.debug(`[project-detector] Go 프로젝트 감지: ${projectPath}`);
      return {
        language: "go",
        commands: { test: "go test ./...", build: "go build ./...", typecheck: "go vet ./..." },
      };
    }

    if (existsSync(join(projectPath, "Cargo.toml"))) {
      logger.debug(`[project-detector] Rust 프로젝트 감지: ${projectPath}`);
      return {
        language: "rust",
        commands: { test: "cargo test", build: "cargo build", lint: "cargo clippy", typecheck: "echo skip" },
      };
    }

    logger.debug(`[project-detector] 언어 감지 불가: ${projectPath}`);
    return { language: "unknown", commands: SAFE_DEFAULT_COMMANDS };
  } catch (err: unknown) {
    logger.warn(`[project-detector] 감지 중 오류: ${getErrorMessage(err)}`);
    return { language: "unknown", commands: SAFE_DEFAULT_COMMANDS };
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
    } catch {
      // 다음 방법으로 폴백
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
