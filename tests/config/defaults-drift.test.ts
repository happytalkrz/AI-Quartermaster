import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

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
