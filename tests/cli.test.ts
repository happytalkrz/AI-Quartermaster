import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProjectConcurrency, parseArgs, printHelp } from "../src/cli.js";

describe("buildProjectConcurrency", () => {
  it("빈 배열이면 빈 객체 반환", () => {
    expect(buildProjectConcurrency([])).toEqual({});
  });

  it("concurrency가 설정된 프로젝트만 포함", () => {
    const projects = [
      { repo: "owner/repo-a", concurrency: 2 },
      { repo: "owner/repo-b" },
    ];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/repo-a": 2 });
  });

  it("모든 프로젝트에 concurrency가 있으면 전부 포함", () => {
    const projects = [
      { repo: "owner/a", concurrency: 1 },
      { repo: "owner/b", concurrency: 3 },
    ];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/a": 1, "owner/b": 3 });
  });

  it("모든 프로젝트에 concurrency가 없으면 빈 객체 반환", () => {
    const projects = [{ repo: "owner/a" }, { repo: "owner/b" }];
    expect(buildProjectConcurrency(projects)).toEqual({});
  });

  it("concurrency가 0이면 포함", () => {
    const projects = [{ repo: "owner/a", concurrency: 0 }];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/a": 0 });
  });
});

describe("parseArgs", () => {
  it("빈 배열이면 빈 객체 반환", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("첫 번째 인수가 subcommand이면 command로 파싱", () => {
    const result = parseArgs(["run"]);
    expect(result.command).toBe("run");
  });

  it("--로 시작하는 첫 번째 인수는 command로 파싱하지 않음", () => {
    const result = parseArgs(["--issue", "42"]);
    expect(result.command).toBeUndefined();
    expect(result.issue).toBe(42);
  });

  it("--issue 파싱", () => {
    const result = parseArgs(["run", "--issue", "123"]);
    expect(result.issue).toBe(123);
  });

  it("--repo 파싱", () => {
    const result = parseArgs(["run", "--repo", "owner/repo"]);
    expect(result.repo).toBe("owner/repo");
  });

  it("--config 파싱", () => {
    const result = parseArgs(["start", "--config", "/path/to/config.yml"]);
    expect(result.config).toBe("/path/to/config.yml");
  });

  it("--target 파싱", () => {
    const result = parseArgs(["run", "--target", "/project/root"]);
    expect(result.target).toBe("/project/root");
  });

  it("--dry-run 파싱", () => {
    const result = parseArgs(["run", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("--port 파싱", () => {
    const result = parseArgs(["start", "--port", "8080"]);
    expect(result.port).toBe(8080);
  });

  it("--mode 파싱", () => {
    const result = parseArgs(["start", "--mode", "polling"]);
    expect(result.mode).toBe("polling");
  });

  it("--interval 파싱", () => {
    const result = parseArgs(["start", "--interval", "30"]);
    expect(result.interval).toBe(30);
  });

  it("--execute 파싱", () => {
    const result = parseArgs(["plan", "--execute"]);
    expect(result.execute).toBe(true);
  });

  it("--job 파싱", () => {
    const result = parseArgs(["resume", "--job", "job-abc-123"]);
    expect(result.job).toBe("job-abc-123");
  });

  it("--non-interactive 파싱", () => {
    const result = parseArgs(["setup", "--non-interactive"]);
    expect(result.nonInteractive).toBe(true);
  });

  it("--config-override key=value 파싱", () => {
    const result = parseArgs(["run", "--config-override", "general.dryRun=true"]);
    expect(result.configOverrides).toEqual({ "general.dryRun": "true" });
  });

  it("--config-override 복수 지정 시 병합", () => {
    const result = parseArgs([
      "run",
      "--config-override", "general.dryRun=true",
      "--config-override", "general.concurrency=2",
    ]);
    expect(result.configOverrides).toEqual({
      "general.dryRun": "true",
      "general.concurrency": "2",
    });
  });

  it("--config-override 값에 = 포함 시 첫 번째 = 기준으로 분리", () => {
    const result = parseArgs(["run", "--config-override", "general.extra=a=b"]);
    expect(result.configOverrides).toEqual({ "general.extra": "a=b" });
  });

  it("--config-override = 없는 경우 무시", () => {
    const result = parseArgs(["run", "--config-override", "nodot"]);
    expect(result.configOverrides).toBeUndefined();
  });

  it("여러 옵션 조합 파싱", () => {
    const result = parseArgs([
      "run",
      "--issue", "42",
      "--repo", "owner/repo",
      "--dry-run",
      "--target", "/some/path",
    ]);
    expect(result).toEqual({
      command: "run",
      issue: 42,
      repo: "owner/repo",
      dryRun: true,
      target: "/some/path",
    });
  });

  it("알 수 없는 플래그는 무시", () => {
    const result = parseArgs(["run", "--unknown-flag", "value"]);
    expect(result.command).toBe("run");
    // unknown flags are silently ignored
  });

  it("값이 없는 --issue는 NaN", () => {
    // --issue at end of args without a value: argv[i+1] is falsy
    const result = parseArgs(["run", "--issue"]);
    expect(result.issue).toBeUndefined();
  });
});

describe("printHelp", () => {
  let consoleLogs: string[];

  beforeEach(() => {
    consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleLogs.push(String(args[0] ?? ""));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("도움말 출력에 주요 커맨드가 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("aqm start");
    expect(output).toContain("aqm run");
    expect(output).toContain("aqm status");
    expect(output).toContain("aqm setup");
    expect(output).toContain("aqm help");
  });

  it("도움말 출력에 옵션 설명이 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("--issue");
    expect(output).toContain("--repo");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--port");
  });

  it("도움말 출력에 환경변수 섹션이 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("GITHUB_WEBHOOK_SECRET");
  });
});
