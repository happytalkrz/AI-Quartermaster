import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

vi.mock("child_process", async () => {
  const actual = await vi.importActual("child_process");
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn(),
  };
});

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { execFile, spawn } from "child_process";
import { executeAutoFix, spawnHealProcess, type DoctorCheck } from "../../src/doctor/heal.js";
import { buildDoctorChecks } from "../../src/setup/doctor.js";

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);

// Helper to create a mock ChildProcess with EventEmitter stdout/stderr
function makeMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  (child as unknown as Record<string, unknown>)["stdout"] = stdout;
  (child as unknown as Record<string, unknown>)["stderr"] = stderr;
  return child as unknown as ChildProcess;
}

describe("buildDoctorChecks — healLevel 매핑", () => {
  const checks = buildDoctorChecks(null, "/tmp/aqroot");

  it("prereq-git는 healLevel 3 (수동 설치 필요)", () => {
    const check = checks.find((c) => c.id === "prereq-git");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(3);
  });

  it("prereq-gh는 healLevel 3", () => {
    const check = checks.find((c) => c.id === "prereq-gh");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(3);
  });

  it("prereq-claude는 healLevel 1 (autoFixCommand 존재)", () => {
    const check = checks.find((c) => c.id === "prereq-claude");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(1);
    expect(check?.autoFixCommand).toEqual(["claude", "update"]);
  });

  it("disk-data는 healLevel 2 (healCommand 존재)", () => {
    const check = checks.find((c) => c.id === "disk-data");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(2);
    expect(check?.healCommand).toBeDefined();
  });

  it("disk-logs는 healLevel 2", () => {
    const check = checks.find((c) => c.id === "disk-logs");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(2);
  });

  it("git-credential-helper는 healLevel 1", () => {
    const check = checks.find((c) => c.id === "git-credential-helper");
    expect(check).toBeDefined();
    expect(check?.healLevel).toBe(1);
    expect(check?.autoFixCommand).toEqual(["gh", "auth", "setup-git"]);
  });

  it("모든 체크의 status 초기값은 pending", () => {
    for (const check of checks) {
      expect(check.status).toBe("pending");
    }
  });

  it("프로젝트 설정 있으면 프로젝트별 체크 추가", () => {
    const config = {
      projects: [{ repo: "owner/repo", path: "/some/path" }],
    } as Parameters<typeof buildDoctorChecks>[0];
    const withProjects = buildDoctorChecks(config, "/tmp/aqroot");
    const projectPath = withProjects.find((c) => c.id === "project-path-owner/repo");
    const safedir = withProjects.find((c) => c.id === "git-safe-directory-owner/repo");
    const gitPerm = withProjects.find((c) => c.id === "git-objects-permission-owner/repo");

    expect(projectPath?.healLevel).toBe(3);
    expect(safedir?.healLevel).toBe(1);
    expect(safedir?.autoFixCommand).toContain("safe.directory");
    expect(gitPerm?.healLevel).toBe(2);
  });
});

describe("executeAutoFix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("autoFixCommand 없으면 실패 반환", async () => {
    const check: DoctorCheck = { id: "test", name: "test", status: "fail", healLevel: 1 };
    const result = await executeAutoFix(check);
    expect(result.success).toBe(false);
    expect(result.output).toContain("autoFixCommand");
  });

  it("빈 autoFixCommand 배열이면 실패 반환", async () => {
    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 1,
      autoFixCommand: [],
    };
    const result = await executeAutoFix(check);
    expect(result.success).toBe(false);
  });

  it("execFile 성공 시 success: true 반환", async () => {
    mockExecFile.mockImplementation(
      (_cmd, _args, _opts, cb) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, "output text", "");
        return {} as ChildProcess;
      },
    );

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 1,
      autoFixCommand: ["echo", "hello"],
    };
    const result = await executeAutoFix(check);
    expect(result.success).toBe(true);
    expect(result.output).toBe("output text");
  });

  it("execFile 실패 시 success: false + 에러 메시지 포함", async () => {
    mockExecFile.mockImplementation(
      (_cmd, _args, _opts, cb) => {
        (cb as (err: Error, stdout: string, stderr: string) => void)(
          new Error("command failed"),
          "",
          "stderr text",
        );
        return {} as ChildProcess;
      },
    );

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 1,
      autoFixCommand: ["bad-cmd"],
    };
    const result = await executeAutoFix(check);
    expect(result.success).toBe(false);
    expect(result.output).toContain("command failed");
    expect(result.output).toContain("stderr text");
  });

  it("stdout + stderr 모두 있으면 결합하여 반환", async () => {
    mockExecFile.mockImplementation(
      (_cmd, _args, _opts, cb) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, "out", "err");
        return {} as ChildProcess;
      },
    );

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 1,
      autoFixCommand: ["cmd"],
    };
    const result = await executeAutoFix(check);
    expect(result.success).toBe(true);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });
});

describe("spawnHealProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("healCommand 없으면 실패 반환", async () => {
    const check: DoctorCheck = { id: "test", name: "test", status: "fail", healLevel: 2 };
    const result = await spawnHealProcess(check, vi.fn(), vi.fn());
    expect(result.success).toBe(false);
    expect(result.output).toContain("healCommand");
  });

  it("빈 healCommand 배열이면 실패 반환", async () => {
    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: [],
    };
    const result = await spawnHealProcess(check, vi.fn(), vi.fn());
    expect(result.success).toBe(false);
  });

  it("stdout 데이터가 onStdout 콜백으로 전달됨", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: ["chmod", "755", "/tmp"],
    };

    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const promise = spawnHealProcess(check, onStdout, onStderr);

    (child.stdout as unknown as EventEmitter).emit("data", Buffer.from("stdout text"));
    child.emit("close", 0);

    await promise;
    expect(onStdout).toHaveBeenCalledWith("stdout text");
  });

  it("stderr 데이터가 onStderr 콜백으로 전달됨", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: ["chmod", "755", "/tmp"],
    };

    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const promise = spawnHealProcess(check, onStdout, onStderr);

    (child.stderr as unknown as EventEmitter).emit("data", Buffer.from("stderr text"));
    child.emit("close", 0);

    await promise;
    expect(onStderr).toHaveBeenCalledWith("stderr text");
  });

  it("종료 코드 0이면 success: true", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: ["chmod", "755", "/tmp"],
    };

    const promise = spawnHealProcess(check, vi.fn(), vi.fn());
    child.emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("종료 코드 비0이면 success: false", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: ["chmod", "755", "/tmp"],
    };

    const promise = spawnHealProcess(check, vi.fn(), vi.fn());
    child.emit("close", 1);

    const result = await promise;
    expect(result.success).toBe(false);
  });

  it("error 이벤트 발생 시 success: false + 에러 메시지", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: ["nonexistent-cmd"],
    };

    const promise = spawnHealProcess(check, vi.fn(), vi.fn());
    child.emit("error", new Error("spawn ENOENT"));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.output).toContain("spawn ENOENT");
  });
});

describe("command injection 방지", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executeAutoFix는 execFile을 사용 — 쉘 해석 없이 인자를 그대로 전달", async () => {
    mockExecFile.mockImplementation(
      (_cmd, _args, _opts, cb) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, "ok", "");
        return {} as ChildProcess;
      },
    );

    const dangerousArgs = ["safe-cmd", "; rm -rf /", "$(whoami)", "`id`", "| cat /etc/passwd"];
    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 1,
      autoFixCommand: dangerousArgs,
    };

    await executeAutoFix(check);

    // execFile은 첫 번째 인자만 명령, 나머지는 args로 전달 — 쉘을 거치지 않음
    expect(mockExecFile).toHaveBeenCalledWith(
      "safe-cmd",
      ["; rm -rf /", "$(whoami)", "`id`", "| cat /etc/passwd"],
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function),
    );
  });

  it("spawnHealProcess는 spawn을 사용 — 쉘 없이 직접 실행", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const dangerousArgs = ["chmod", "755 /tmp; rm -rf /", "$(evil)"];
    const check: DoctorCheck = {
      id: "test",
      name: "test",
      status: "fail",
      healLevel: 2,
      healCommand: dangerousArgs,
    };

    const promise = spawnHealProcess(check, vi.fn(), vi.fn());
    child.emit("close", 0);
    await promise;

    // spawn은 shell: false 기본값 — 첫 인자 cmd, 나머지 args로 분리 전달
    expect(mockSpawn).toHaveBeenCalledWith(
      "chmod",
      ["755 /tmp; rm -rf /", "$(evil)"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });
});
