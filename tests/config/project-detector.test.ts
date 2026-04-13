import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectProjectCommands } from "../../src/config/project-detector.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `aq-detector-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectProjectCommands", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Node.js 감지", () => {
    it("package.json이 있으면 nodejs로 감지한다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: {} }));
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("nodejs");
    });

    it("scripts.test가 있으면 test는 npm test", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("npm test");
    });

    it("scripts.test가 없으면 test는 echo skip", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: {} }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("echo skip");
    });

    it("scripts.lint가 있으면 lint 커맨드 세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { lint: "eslint ." } }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.lint).toBe("npm run lint");
    });

    it("scripts.lint가 없으면 lint 커맨드 미세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: {} }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.lint).toBeUndefined();
    });

    it("scripts.build가 있으면 build 커맨드 세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.build).toBe("npm run build");
    });

    it("scripts.typecheck가 있으면 typecheck 커맨드 세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.typecheck).toBe("npm run typecheck");
    });

    it("scripts.type-check가 있으면 typecheck 커맨드 세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { "type-check": "tsc --noEmit" } }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.typecheck).toBe("npm run type-check");
    });

    it("typecheck 스크립트 없고 tsconfig.json 있으면 npx tsc --noEmit", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: {} }),
      );
      writeFileSync(join(testDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
      const result = detectProjectCommands(testDir);
      expect(result.commands.typecheck).toBe("npx tsc --noEmit");
    });

    it("typecheck 스크립트 없고 tsconfig.json도 없으면 typecheck 미세팅", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: {} }),
      );
      const result = detectProjectCommands(testDir);
      expect(result.commands.typecheck).toBeUndefined();
    });
  });

  describe("Kotlin-Gradle 감지", () => {
    it("build.gradle.kts가 있으면 kotlin-gradle로 감지한다", () => {
      writeFileSync(join(testDir, "build.gradle.kts"), "");
      writeFileSync(join(testDir, "gradlew"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("kotlin-gradle");
      expect(result.commands.test).toBe("./gradlew test");
      expect(result.commands.build).toBe("./gradlew build");
      expect(result.commands.typecheck).toBe("echo skip");
      expect(result.confidence).toBe("high");
    });

    it("gradlew가 없으면 gradle fallback (medium confidence)", () => {
      writeFileSync(join(testDir, "build.gradle.kts"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("kotlin-gradle");
      expect(result.commands.test).toBe("gradle test");
      expect(result.commands.build).toBe("gradle build");
      expect(result.confidence).toBe("medium");
      expect(result.fallbackReason).toBe("gradlew not found");
    });
  });

  describe("Java-Gradle 감지", () => {
    it("build.gradle가 있으면 java-gradle로 감지한다", () => {
      writeFileSync(join(testDir, "build.gradle"), "");
      writeFileSync(join(testDir, "gradlew"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("java-gradle");
      expect(result.commands.test).toBe("./gradlew test");
      expect(result.commands.build).toBe("./gradlew build");
      expect(result.commands.typecheck).toBe("echo skip");
      expect(result.confidence).toBe("high");
    });

    it("gradlew가 없으면 gradle fallback (medium confidence)", () => {
      writeFileSync(join(testDir, "build.gradle"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("java-gradle");
      expect(result.commands.test).toBe("gradle test");
      expect(result.commands.build).toBe("gradle build");
      expect(result.confidence).toBe("medium");
      expect(result.fallbackReason).toBe("gradlew not found");
    });
  });

  describe("Java-Maven 감지", () => {
    it("pom.xml이 있으면 java-maven으로 감지한다", () => {
      writeFileSync(join(testDir, "pom.xml"), "<project/>");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("java-maven");
      expect(result.commands.test).toBe("mvn test");
      expect(result.commands.build).toBe("mvn package -DskipTests");
      expect(result.commands.typecheck).toBe("echo skip");
    });
  });

  describe("Python 감지", () => {
    it("pyproject.toml이 있으면 python으로 감지한다", () => {
      writeFileSync(join(testDir, "pyproject.toml"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("python");
      expect(result.commands.test).toBe("python -m pytest");
      expect(result.commands.lint).toBe("ruff check .");
    });

    it("setup.py가 있으면 python으로 감지한다", () => {
      writeFileSync(join(testDir, "setup.py"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("python");
    });

    it("requirements.txt가 있으면 python으로 감지한다", () => {
      writeFileSync(join(testDir, "requirements.txt"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("python");
    });
  });

  describe("Go 감지", () => {
    it("go.mod가 있으면 go로 감지한다", () => {
      writeFileSync(join(testDir, "go.mod"), "module example.com/app\n\ngo 1.21\n");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("go");
      expect(result.commands.test).toBe("go test ./...");
      expect(result.commands.build).toBe("go build ./...");
      expect(result.commands.typecheck).toBe("go vet ./...");
    });
  });

  describe("Rust 감지", () => {
    it("Cargo.toml이 있으면 rust로 감지한다", () => {
      writeFileSync(join(testDir, "Cargo.toml"), "[package]\nname = \"app\"\n");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("rust");
      expect(result.commands.test).toBe("cargo test");
      expect(result.commands.build).toBe("cargo build");
      expect(result.commands.lint).toBe("cargo clippy");
      expect(result.commands.typecheck).toBe("echo skip");
    });
  });

  describe("감지 불가 fallback", () => {
    it("마커 파일이 없으면 unknown + echo skip fallback", () => {
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("unknown");
      expect(result.commands.test).toBe("echo skip");
    });
  });

  describe("lockfile 기반 패키지 매니저 감지", () => {
    it("pnpm-lock.yaml이 있으면 pnpm으로 감지한다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("pnpm");
      expect(result.confidence).toBe("high");
      expect(result.fallbackReason).toBeUndefined();
    });

    it("pnpm-lock.yaml이 있으면 test 커맨드가 pnpm test이다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("pnpm test");
    });

    it("pnpm-lock.yaml이 있으면 lint/build 커맨드에 pnpm run을 사용한다", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "tsc" } }),
      );
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.lint).toBe("pnpm run lint");
      expect(result.commands.build).toBe("pnpm run build");
    });

    it("yarn.lock이 있으면 yarn으로 감지한다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "yarn.lock"), "");
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("yarn");
      expect(result.confidence).toBe("high");
      expect(result.fallbackReason).toBeUndefined();
    });

    it("yarn.lock이 있으면 test 커맨드가 yarn test이다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "yarn.lock"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("yarn test");
    });

    it("yarn.lock이 있으면 lint/build 커맨드에 yarn을 사용한다", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "tsc" } }),
      );
      writeFileSync(join(testDir, "yarn.lock"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.lint).toBe("yarn lint");
      expect(result.commands.build).toBe("yarn build");
    });

    it("bun.lockb가 있으면 bun으로 감지한다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "bun.lockb"), "");
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("bun");
      expect(result.confidence).toBe("high");
      expect(result.fallbackReason).toBeUndefined();
    });

    it("bun.lockb가 있으면 test 커맨드가 bun test이다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "bun.lockb"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("bun test");
    });

    it("bun.lockb가 있으면 lint/build 커맨드에 bun run을 사용한다", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "tsc" } }),
      );
      writeFileSync(join(testDir, "bun.lockb"), "");
      const result = detectProjectCommands(testDir);
      expect(result.commands.lint).toBe("bun run lint");
      expect(result.commands.build).toBe("bun run build");
    });

    it("lockfile이 없으면 npm fallback이고 confidence가 medium이다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("npm");
      expect(result.confidence).toBe("medium");
      expect(result.fallbackReason).toBe("lockfile 없음 — npm fallback");
    });

    it("lockfile이 없으면 test 커맨드가 npm test이다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      const result = detectProjectCommands(testDir);
      expect(result.commands.test).toBe("npm test");
    });

    it("scripts.test가 없고 lockfile도 없으면 test는 echo skip이고 npm fallback", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: {} }));
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("npm");
      expect(result.commands.test).toBe("echo skip");
      expect(result.confidence).toBe("medium");
    });

    it("pnpm-lock.yaml과 yarn.lock이 함께 있으면 pnpm이 우선한다", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
      writeFileSync(join(testDir, "yarn.lock"), "");
      const result = detectProjectCommands(testDir);
      expect(result.packageManager).toBe("pnpm");
    });
  });

  describe("감지 우선순위", () => {
    it("package.json이 있으면 build.gradle.kts보다 nodejs가 우선", () => {
      writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: {} }));
      writeFileSync(join(testDir, "build.gradle.kts"), "");
      const result = detectProjectCommands(testDir);
      expect(result.language).toBe("nodejs");
    });
  });
});

describe("detectBaseBranch", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTempDir();
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("git symbolic-ref 성공 시 브랜치명 반환", async () => {
    vi.doMock("../../src/utils/cli-runner.js", () => ({
      runCli: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: "refs/remotes/origin/main\n", stderr: "" }),
    }));
    const { detectBaseBranch } = await import("../../src/config/project-detector.js");
    const branch = await detectBaseBranch(testDir);
    expect(branch).toBe("main");
  });

  it("symbolic-ref 실패 시 git config init.defaultBranch 사용", async () => {
    vi.doMock("../../src/utils/cli-runner.js", () => ({
      runCli: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "error" })
        .mockResolvedValueOnce({ exitCode: 0, stdout: "master\n", stderr: "" }),
    }));
    const { detectBaseBranch } = await import("../../src/config/project-detector.js");
    const branch = await detectBaseBranch(testDir);
    expect(branch).toBe("master");
  });

  it("모두 실패 시 main 반환", async () => {
    vi.doMock("../../src/utils/cli-runner.js", () => ({
      runCli: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "error" })
        .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "error" }),
    }));
    const { detectBaseBranch } = await import("../../src/config/project-detector.js");
    const branch = await detectBaseBranch(testDir);
    expect(branch).toBe("main");
  });

  it("runCli가 throw해도 main 반환", async () => {
    vi.doMock("../../src/utils/cli-runner.js", () => ({
      runCli: vi.fn().mockRejectedValue(new Error("not a git repo")),
    }));
    const { detectBaseBranch } = await import("../../src/config/project-detector.js");
    const branch = await detectBaseBranch(testDir);
    expect(branch).toBe("main");
  });
});
