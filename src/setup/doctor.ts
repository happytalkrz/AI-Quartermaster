import { existsSync, accessSync, constants, readFileSync } from "fs";
import { resolve } from "path";
import * as net from "net";
import { runCli } from "../utils/cli-runner.js";
import { AQConfig } from "../types/config.js";
import { TryLoadConfigResult } from "../config/loader.js";
import { DoctorCheck } from "../doctor/heal.js";

const MIN_CLAUDE_VERSION = "1.0.0";

/** Compare semver strings. Returns negative if a < b, 0 if equal, positive if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ANSI color helpers
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function pass(name: string): void {
  console.log(`  ${green("PASS")} ${name}`);
}

function warn(name: string, message: string): void {
  console.log(`  ${yellow("WARN")} ${name}: ${message}`);
}

function fail(name: string, message: string): void {
  console.log(`  ${red("FAIL")} ${name}: ${message}`);
}

async function checkPrerequisites(): Promise<void> {
  console.log("\n[사전 요구사항]");
  for (const tool of ["git", "gh", "claude"]) {
    const result = await runCli(tool, ["--version"], { timeout: 5000 });
    if (result.exitCode === 0) {
      if (tool === "claude") {
        const output = (result.stdout + result.stderr).trim();
        // Extract version like "1.2.3" from output such as "Claude Code 1.2.3" or "1.2.3"
        const match = output.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          const version = match[1];
          if (compareSemver(version, MIN_CLAUDE_VERSION) < 0) {
            warn(`claude CLI (v${version})`, `최소 권장 버전은 v${MIN_CLAUDE_VERSION}입니다 — 'claude update' 또는 npm으로 업데이트하세요`);
          } else {
            pass(`claude CLI (v${version})`);
          }
        } else {
          pass(`claude CLI (버전 파싱 불가: ${output.slice(0, 40)})`);
        }
      } else {
        pass(`${tool} CLI`);
      }
    } else {
      fail(`${tool} CLI`, `'${tool} --version' 실패 — PATH에 설치되어 있는지 확인하세요`);
    }
  }
}

async function checkGhAuth(): Promise<void> {
  console.log("\n[GitHub 인증]");
  const result = await runCli("gh", ["auth", "status"], { timeout: 10000 });
  const output = result.stdout + result.stderr;
  if (result.exitCode === 0 && !output.includes("not logged in")) {
    pass("gh auth");

    // Check if gh is configured as git credential helper
    const credResult = await runCli("git", ["config", "--global", "credential.helper"], { timeout: 5000 });
    const credHelper = credResult.stdout.trim();
    if (credHelper.includes("gh") || credHelper.includes("manager") || credHelper.includes("store")) {
      pass(`git credential helper (${credHelper})`);
    } else {
      // Check gh auth setup-git status
      const setupResult = await runCli("gh", ["auth", "setup-git", "--hostname", "github.com"], { timeout: 10000 });
      if (setupResult.exitCode === 0) {
        pass("git credential helper (gh auth setup-git 자동 설정 완료)");
      } else {
        warn("git credential helper", "HTTPS push 시 비밀번호를 물어볼 수 있습니다 — 'gh auth setup-git' 실행을 권장합니다");
      }
    }
  } else {
    fail("gh auth", "'gh auth login'으로 먼저 로그인하세요");
  }
}

async function checkGitObjectsPermission(projectPath: string, projectRepo: string): Promise<void> {
  const result = await runCli("find", [resolve(projectPath, ".git/objects"), "-user", "root", "-maxdepth", "2"], { timeout: 5000 });
  if (result.exitCode === 0 && result.stdout.trim().length > 0) {
    const count = result.stdout.trim().split("\n").length;
    fail(
      `git 권한 (${projectRepo})`,
      `.git/objects/ 내 root 소유 파일 ${count}개 발견 — sudo chown -R $(whoami) ${resolve(projectPath, ".git/")} 실행하세요`,
    );
  } else {
    pass(`git 권한 (${projectRepo})`);
  }
}

async function checkGitSafeDirectory(projectPath: string, projectRepo: string): Promise<void> {
  const result = await runCli("git", ["-C", projectPath, "rev-parse", "--git-dir"], { timeout: 5000 });
  const output = result.stdout + result.stderr;
  if (result.exitCode === 0) {
    pass(`git safe.directory (${projectRepo})`);
  } else if (output.includes("dubious ownership") || output.includes("safe.directory")) {
    fail(
      `git safe.directory (${projectRepo})`,
      `git config --global --add safe.directory ${projectPath}  를 실행하세요`,
    );
  } else {
    fail(`git safe.directory (${projectRepo})`, result.stderr.trim() || "git 작업 실패");
  }
}

async function checkRemoteUrl(projectPath: string, projectRepo: string): Promise<void> {
  const result = await runCli("git", ["-C", projectPath, "remote", "get-url", "origin"], {
    timeout: 5000,
  });
  if (result.exitCode !== 0) {
    warn(`remote URL (${projectRepo})`, "origin remote를 찾을 수 없습니다");
    return;
  }
  const url = result.stdout.trim();
  if (url.startsWith("git@") || url.startsWith("ssh://")) {
    pass(`remote URL (${projectRepo}) [SSH: ${url}]`);
  } else if (url.startsWith("https://")) {
    warn(
      `remote URL (${projectRepo})`,
      `HTTPS 사용 중 (${url}) — SSH 사용 권장: git remote set-url origin git@github.com:<owner>/<repo>.git`,
    );
  } else {
    warn(`remote URL (${projectRepo})`, `알 수 없는 remote URL 형식: ${url}`);
  }
}

function checkProjectPath(projectPath: string, projectRepo: string): boolean {
  console.log(`\n[프로젝트: ${projectRepo}]`);
  if (!existsSync(projectPath)) {
    fail(`경로 존재 여부 (${projectRepo})`, `경로가 없습니다: ${projectPath}`);
    return false;
  }
  const gitDir = resolve(projectPath, ".git");
  if (!existsSync(gitDir)) {
    fail(`git 저장소 (${projectRepo})`, `${projectPath} 는 git 저장소가 아닙니다`);
    return false;
  }
  pass(`경로 & git 저장소 (${projectRepo})`);
  return true;
}

function checkPackageJsonScripts(
  projectPath: string,
  projectRepo: string,
  commands: { test?: string; lint?: string; build?: string },
): void {
  const pkgPath = resolve(projectPath, "package.json");
  if (!existsSync(pkgPath)) {
    // Not a Node project — skip silently
    return;
  }

  let scripts: Record<string, string> = {};
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf-8"));
    scripts = raw?.scripts ?? {};
  } catch {
    warn(`package.json (${projectRepo})`, "package.json 파싱 실패");
    return;
  }

  const entries: Array<[string, string | undefined]> = [
    ["test", commands.test],
    ["lint", commands.lint],
    ["build", commands.build],
  ];

  for (const [label, cmd] of entries) {
    if (!cmd) continue;
    // Extract npm script name from commands like "npm test", "npm run lint"
    const match = cmd.match(/npm(?:\s+run)?\s+(\S+)/);
    if (!match) continue;
    const scriptName = match[1];
    if (!scripts[scriptName]) {
      warn(
        `package.json script (${projectRepo})`,
        `config의 ${label} 명령(${cmd})이 참조하는 스크립트 "${scriptName}"가 package.json에 없습니다`,
      );
    } else {
      pass(`package.json script "${scriptName}" (${projectRepo})`);
    }
  }
}

function checkPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    console.log("\n[포트 가용성]");
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        warn(`포트 ${port}`, `이미 사용 중입니다 — 다른 포트를 사용하거나 기존 프로세스를 종료하세요`);
      } else {
        warn(`포트 ${port}`, err.message);
      }
      resolve();
    });
    server.once("listening", () => {
      server.close(() => {
        pass(`포트 ${port} 가용`);
        resolve();
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

function checkDiskWritable(aqRoot: string): void {
  console.log("\n[디스크 쓰기 권한]");
  for (const dir of ["data", "logs"]) {
    const dirPath = resolve(aqRoot, dir);
    if (!existsSync(dirPath)) {
      // Directory doesn't exist yet — check parent is writable
      try {
        accessSync(aqRoot, constants.W_OK);
        pass(`${dir}/ (생성 가능)`);
      } catch {
        fail(`${dir}/`, `${aqRoot} 에 쓰기 권한이 없습니다`);
      }
    } else {
      try {
        accessSync(dirPath, constants.W_OK);
        pass(`${dir}/ 쓰기 가능`);
      } catch {
        fail(`${dir}/`, `${dirPath} 에 쓰기 권한이 없습니다`);
      }
    }
  }
}

/**
 * 기존 doctor 체크들을 DoctorCheck 형태로 매핑하여 반환한다.
 * 각 체크는 healLevel과 autoFixCommand/healCommand/guide가 부여된다.
 * status는 실제 체크 실행 전이므로 "pending"으로 초기화된다.
 */
export function buildDoctorChecks(config: AQConfig | null, aqRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    // 사전 요구사항 — git/gh는 수동 설치 필요(Level3), claude는 자동 업데이트 가능(Level1)
    {
      id: "prereq-git",
      name: "git CLI",
      status: "pending",
      healLevel: 3,
      guide: "git를 설치하세요: https://git-scm.com/downloads",
      docsUrl: "https://git-scm.com/downloads",
    },
    {
      id: "prereq-gh",
      name: "gh CLI",
      status: "pending",
      healLevel: 3,
      guide: "GitHub CLI를 설치하세요: https://cli.github.com",
      docsUrl: "https://cli.github.com",
    },
    {
      id: "prereq-claude",
      name: "claude CLI",
      status: "pending",
      healLevel: 1,
      autoFixCommand: ["claude", "update"],
      guide: "claude CLI를 설치하거나 업데이트하세요",
    },
    // GitHub 인증
    {
      id: "gh-auth",
      name: "gh auth",
      status: "pending",
      healLevel: 3,
      guide: "'gh auth login'으로 GitHub에 로그인하세요",
    },
    {
      id: "git-credential-helper",
      name: "git credential helper",
      status: "pending",
      healLevel: 1,
      autoFixCommand: ["gh", "auth", "setup-git"],
      guide: "'gh auth setup-git'을 실행하세요",
    },
    // 포트 가용성
    {
      id: "port-3000",
      name: "포트 3000",
      status: "pending",
      healLevel: 3,
      guide: "포트 3000을 사용 중인 프로세스를 종료하거나 다른 포트를 사용하세요",
    },
    // 디스크 쓰기 권한
    {
      id: "disk-data",
      name: "data/ 쓰기 권한",
      status: "pending",
      healLevel: 2,
      healCommand: ["chmod", "755", resolve(aqRoot, "data")],
      guide: `chmod 755 ${resolve(aqRoot, "data")}`,
    },
    {
      id: "disk-logs",
      name: "logs/ 쓰기 권한",
      status: "pending",
      healLevel: 2,
      healCommand: ["chmod", "755", resolve(aqRoot, "logs")],
      guide: `chmod 755 ${resolve(aqRoot, "logs")}`,
    },
  ];

  // 프로젝트별 체크
  const projects = config?.projects ?? [];
  for (const project of projects) {
    checks.push({
      id: `project-path-${project.repo}`,
      name: `경로 & git 저장소 (${project.repo})`,
      status: "pending",
      healLevel: 3,
      guide: `${project.path} 경로와 git 저장소를 확인하세요`,
    });
    checks.push({
      id: `git-safe-directory-${project.repo}`,
      name: `git safe.directory (${project.repo})`,
      status: "pending",
      healLevel: 1,
      autoFixCommand: ["git", "config", "--global", "--add", "safe.directory", project.path],
      guide: `git config --global --add safe.directory ${project.path}`,
    });
    checks.push({
      id: `git-objects-permission-${project.repo}`,
      name: `git 권한 (${project.repo})`,
      status: "pending",
      healLevel: 2,
      healCommand: ["chown", "-R", process.env["USER"] ?? "$(whoami)", resolve(project.path, ".git")],
      guide: `sudo chown -R $(whoami) ${resolve(project.path, ".git")}`,
    });
    checks.push({
      id: `remote-url-${project.repo}`,
      name: `remote URL (${project.repo})`,
      status: "pending",
      healLevel: 3,
      guide: `SSH 사용 권장: git remote set-url origin git@github.com:<owner>/<repo>.git`,
    });
  }

  return checks;
}

export async function runDoctor(
  config: AQConfig | null,
  aqRoot: string,
  configError?: TryLoadConfigResult['error']
): Promise<void> {
  console.log("\n=== AI Quartermaster Doctor ===");

  // Always check prerequisites and GitHub auth
  await checkPrerequisites();
  await checkGhAuth();

  // Show config file status
  if (configError) {
    console.log("\n[설정 파일]");
    switch (configError.type) {
      case 'not_found':
        fail("config.yml", configError.message);
        break;
      case 'yaml_syntax':
        fail("YAML 문법", configError.message);
        break;
      case 'validation':
        fail("설정 검증", configError.message);
        if (configError.details && configError.details.length > 0) {
          configError.details.forEach(detail => {
            console.log(`    ${red("ERROR")} ${detail}`);
          });
        }
        break;
    }
  } else if (config === null) {
    console.log("\n[설정 파일]");
    warn("config.yml", "설정 파일을 로드하지 않고 실행 중입니다");
  } else {
    console.log("\n[설정 파일]");
    pass("config.yml 로드 성공");
  }

  // Project-specific checks only if config is available
  if (config) {
    const projects = config.projects ?? [];
    for (const project of projects) {
      const pathOk = checkProjectPath(project.path, project.repo);
      if (pathOk) {
        await checkGitSafeDirectory(project.path, project.repo);
        await checkGitObjectsPermission(project.path, project.repo);
        await checkRemoteUrl(project.path, project.repo);

        const projectCommands = project.commands
          ? { ...config.commands, ...project.commands }
          : config.commands;
        checkPackageJsonScripts(project.path, project.repo, {
          test: projectCommands.test,
          lint: projectCommands.lint,
          build: projectCommands.build,
        });
      }
    }

    if (projects.length === 0) {
      console.log("\n[프로젝트]");
      warn("projects", "config.yml에 등록된 프로젝트가 없습니다");
    }
  } else {
    console.log("\n[프로젝트]");
    warn("projects", "설정 파일이 없어 프로젝트별 점검을 건너뜁니다");
  }

  const port = 3000; // default; config doesn't store port
  await checkPort(port);

  checkDiskWritable(aqRoot);

  console.log("\n=== Doctor 완료 ===\n");
}
