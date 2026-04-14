import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { parse as parseYaml } from "yaml";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { loadConfig } from "../../src/config/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const CONFIG_REF_PATH = resolve(ROOT, "config.reference.yml");
const README_PATH = resolve(ROOT, "README.md");

// config.reference.yml 주석에서 "기본값: X" 추출
function extractCommentDefault(text: string, fieldPattern: RegExp): string | undefined {
  const lines = text.split("\n");
  const line = lines.find(l => fieldPattern.test(l) && /기본값/.test(l));
  if (!line) return undefined;
  const match = line.match(/기본값:\s*["']?([^"'\s,)\]]+)["']?/);
  return match?.[1];
}

describe("DEFAULT_CONFIG 핵심 필드 기본값", () => {
  it("general.locale 기본값은 'en'", () => {
    expect(DEFAULT_CONFIG.general.locale).toBe("en");
  });

  it("general.serverMode 기본값은 'hybrid'", () => {
    expect(DEFAULT_CONFIG.general.serverMode).toBe("hybrid");
  });

  it("review.simplify.enabled 기본값은 true", () => {
    expect(DEFAULT_CONFIG.review.simplify.enabled).toBe(true);
  });

  it("worktree.rootPath 기본값은 '.worktrees'", () => {
    expect(DEFAULT_CONFIG.worktree.rootPath).toBe(".worktrees");
  });

  it("safety.rollbackStrategy 기본값은 'failed-only'", () => {
    expect(DEFAULT_CONFIG.safety.rollbackStrategy).toBe("failed-only");
  });

  it("safety.stopConditions 기본값에 SAFETY_VIOLATION 포함", () => {
    expect(DEFAULT_CONFIG.safety.stopConditions).toContain("SAFETY_VIOLATION");
  });

  it("commands.claudeCli.maxTurns 기본값은 100", () => {
    expect(DEFAULT_CONFIG.commands.claudeCli.maxTurns).toBe(100);
  });

  it("commands.typecheck 기본값은 'npm run typecheck'", () => {
    expect(DEFAULT_CONFIG.commands.typecheck).toBe("npm run typecheck");
  });

  it("commands.preInstall 기본값은 빈 문자열", () => {
    expect(DEFAULT_CONFIG.commands.preInstall).toBe("");
  });
});

describe("config.reference.yml drift 검증", () => {
  const refText = readFileSync(CONFIG_REF_PATH, "utf-8");
  const refYaml = parseYaml(refText) as Record<string, unknown>;

  const general = refYaml["general"] as Record<string, unknown>;
  const worktree = refYaml["worktree"] as Record<string, unknown>;
  const commands = refYaml["commands"] as Record<string, unknown>;
  const claudeCli = commands["claudeCli"] as Record<string, unknown>;
  const review = refYaml["review"] as Record<string, unknown>;
  const simplify = review["simplify"] as Record<string, unknown>;
  const safety = refYaml["safety"] as Record<string, unknown>;

  it("locale 값이 defaults.ts와 일치", () => {
    expect(general["locale"]).toBe(DEFAULT_CONFIG.general.locale);
  });

  it("serverMode 기본값 주석이 defaults.ts와 일치", () => {
    const val = extractCommentDefault(refText, /serverMode/);
    expect(val).toBe(DEFAULT_CONFIG.general.serverMode);
  });

  it("worktree.rootPath 값이 defaults.ts와 일치", () => {
    expect(worktree["rootPath"]).toBe(DEFAULT_CONFIG.worktree.rootPath);
  });

  it("commands.claudeCli.maxTurns 값이 defaults.ts와 일치", () => {
    expect(claudeCli["maxTurns"]).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurns);
  });

  it("commands.claudeCli.maxTurnsPerMode 값이 defaults.ts와 일치", () => {
    const maxTurnsPerMode = claudeCli["maxTurnsPerMode"] as Record<string, number>;
    expect(maxTurnsPerMode["economy"]).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.economy);
    expect(maxTurnsPerMode["standard"]).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.standard);
    expect(maxTurnsPerMode["thorough"]).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.thorough);
  });

  it("commands.typecheck 값이 defaults.ts와 일치", () => {
    expect(commands["typecheck"]).toBe(DEFAULT_CONFIG.commands.typecheck);
  });

  it("commands.preInstall 값이 defaults.ts와 일치", () => {
    expect(commands["preInstall"]).toBe(DEFAULT_CONFIG.commands.preInstall);
  });

  it("review.simplify.enabled 값이 defaults.ts와 일치", () => {
    expect(simplify["enabled"]).toBe(DEFAULT_CONFIG.review.simplify.enabled);
  });

  it("safety.rollbackStrategy 값이 defaults.ts와 일치", () => {
    expect(safety["rollbackStrategy"]).toBe(DEFAULT_CONFIG.safety.rollbackStrategy);
  });

  it("safety.stopConditions에 SAFETY_VIOLATION 포함", () => {
    expect(safety["stopConditions"]).toContain("SAFETY_VIOLATION");
  });
});

describe("README.md drift 검증", () => {
  const readme = readFileSync(README_PATH, "utf-8");

  it("README에 rollbackStrategy 'failed-only' 표기", () => {
    expect(readme).toContain(`rollbackStrategy: "failed-only"`);
  });

  it("README에 simplify enabled: true 표기", () => {
    expect(readme).toContain("enabled: true");
  });

  it("README에 serverMode hybrid 언급", () => {
    expect(readme).toContain("hybrid");
  });

  it("README에 preInstall 빈 문자열 표기", () => {
    expect(readme).toContain(`preInstall: ""`);
  });

  it("README에 typecheck 명령어 표기", () => {
    expect(readme).toContain(`typecheck: "npm run typecheck"`);
  });
});

describe("loader 마이그레이션: maxTurnsPerMode 자동 시드", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-drift-test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("maxTurnsPerMode 없는 config 로드 시 defaults로 자동 시드", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
commands:
  claudeCli:
    maxTurns: 100
`);
    const config = loadConfig(testDir);
    expect(config.commands.claudeCli.maxTurnsPerMode).toBeDefined();
    expect(config.commands.claudeCli.maxTurnsPerMode.economy).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.economy);
    expect(config.commands.claudeCli.maxTurnsPerMode.standard).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.standard);
    expect(config.commands.claudeCli.maxTurnsPerMode.thorough).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.thorough);
  });

  it("maxTurnsPerMode 빈 객체 config 로드 시 defaults로 자동 시드", () => {
    writeFileSync(join(testDir, "config.yml"), `
general:
  projectName: "test-project"
git:
  allowedRepos:
    - "test/repo"
commands:
  claudeCli:
    maxTurnsPerMode: {}
`);
    const config = loadConfig(testDir);
    expect(config.commands.claudeCli.maxTurnsPerMode).toBeDefined();
    expect(config.commands.claudeCli.maxTurnsPerMode.economy).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.economy);
    expect(config.commands.claudeCli.maxTurnsPerMode.standard).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.standard);
    expect(config.commands.claudeCli.maxTurnsPerMode.thorough).toBe(DEFAULT_CONFIG.commands.claudeCli.maxTurnsPerMode.thorough);
  });
});
