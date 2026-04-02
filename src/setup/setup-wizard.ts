import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { runCli } from "../utils/cli-runner.js";
import { randomBytes } from "crypto";
import { askQuestion, askConfirm, askChoice } from "./prompt-utils.js";
import { validateRepoFormat, validateLocalPath, suggestClone, handleValidationError } from "./validators.js";
import type { SetupOptions, WizardAnswers, PipelineMode } from "../types/config.js";

export async function runSetup(aqRoot: string, options?: SetupOptions): Promise<void> {
  console.log("\n=== AI Quartermaster Setup ===\n");

  // 1. Check prerequisites
  console.log("1. 사전 요구사항 확인...");
  await checkPrerequisite("git", ["--version"], "Git");
  await checkPrerequisite("gh", ["auth", "status"], "GitHub CLI (인증 필요: gh auth login)");
  await checkPrerequisite("claude", ["--version"], "Claude CLI");

  // Setup gh as git credential helper (prevents HTTPS password prompts)
  try {
    const { runCli } = await import("../utils/cli-runner.js");
    await runCli("gh", ["auth", "setup-git"], { timeout: 10000 });
    console.log("   git credential helper 설정 완료 (gh auth)");
  } catch {
    console.log("   git credential helper 설정 실패 — 'gh auth setup-git' 수동 실행 권장");
  }

  console.log("   모든 사전 요구사항 충족\n");

  // 2. Create config.yml
  console.log("2. 설정 파일 생성...");
  const configPath = resolve(aqRoot, "config.yml");

  if (options?.nonInteractive) {
    // 비인터랙티브 모드: 기본 템플릿 생성
    if (existsSync(configPath)) {
      console.log("   config.yml 이미 존재 (건너뜀)");
    } else {
      const minimalConfig = `# AI 병참부 최소 설정 파일
# 전체 옵션은 config.reference.yml 참조

projects:
  - repo: "owner/repo-name"        # 필수: GitHub 저장소 (owner/repo)
    path: "/path/to/local/clone"   # 필수: 로컬 클론 경로

# 추가 설정이 필요하면 config.reference.yml을 참조하세요
`;
      writeFileSync(configPath, minimalConfig, 'utf-8');
      console.log("   config.yml 생성됨 (최소 템플릿)");
    }
  } else {
    // 인터랙티브 모드: 위자드 실행
    if (existsSync(configPath)) {
      const overwrite = await askConfirm("   config.yml이 이미 존재합니다. 덮어쓰시겠습니까?");
      if (!overwrite) {
        console.log("   config.yml 건너뜀 (사용자 선택)");
        return;
      }
    }

    const answers = await runInteractiveWizard();
    const userConfig = `# AI 병참부 프로젝트 설정

projects:
  - repo: "${answers.repo}"
    path: "${answers.path}"
    mode: "${answers.mode}"
`;
    writeFileSync(configPath, userConfig, 'utf-8');
    console.log("   config.yml 생성됨 (사용자 설정)");
  }

  // 3. Create .env
  const envPath = resolve(aqRoot, ".env");
  const envExamplePath = resolve(aqRoot, ".env.example");

  if (existsSync(envPath)) {
    console.log("   .env 이미 존재 (건너뜀)");
  } else if (existsSync(envExamplePath)) {
    const secret = randomBytes(32).toString("hex");
    const template = readFileSync(envExamplePath, "utf-8");
    const envContent = template.replace(
      "GITHUB_WEBHOOK_SECRET=your-webhook-secret-here",
      `GITHUB_WEBHOOK_SECRET=${secret}`,
    );
    writeFileSync(envPath, envContent);
    console.log("   .env 생성됨 (webhook secret 자동 생성)");
  } else {
    const secret = randomBytes(32).toString("hex");
    const envContent = `GITHUB_WEBHOOK_SECRET=${secret}\nSMEE_URL=\nPORT=3000\n`;
    writeFileSync(envPath, envContent);
    console.log("   .env 생성됨 (webhook secret 자동 생성)");
  }
  console.log("");

  // 4. Create smee channel
  console.log("3. Smee.io 채널 생성...");
  const envContent = readFileSync(envPath, "utf-8");
  let smeeUrl = envContent.match(/SMEE_URL=(.+)/)?.[1]?.trim();

  if (smeeUrl) {
    console.log(`   Smee URL 이미 설정됨: ${smeeUrl}`);
  } else {
    const smeeResult = await runCli("curl", ["-s", "-o", "/dev/null", "-w", "%{redirect_url}", "https://smee.io/new"], { timeout: 10000 });
    smeeUrl = smeeResult.stdout.trim();
    if (smeeUrl && smeeUrl.startsWith("https://smee.io/")) {
      const updated = envContent.replace("SMEE_URL=", `SMEE_URL=${smeeUrl}`);
      writeFileSync(envPath, updated);
      console.log(`   Smee 채널 생성: ${smeeUrl}`);
    } else {
      console.log("   Smee 채널 생성 실패. 수동으로 https://smee.io/new 에서 생성하세요.");
    }
  }
  console.log("");

  // 5. Auto-register webhooks for configured projects
  console.log("4. Webhook 등록 확인...");
  const configPath2 = resolve(aqRoot, "config.yml");
  if (existsSync(configPath2) && smeeUrl) {
    try {
      const { parse } = await import("yaml");
      const configContent = readFileSync(configPath2, "utf-8");
      const parsed = parse(configContent);
      const projects = parsed?.projects ?? [];
      for (const project of projects) {
        if (project.repo && project.repo !== "owner/repo-name") {
          console.log(`   ${project.repo} webhook 등록 중...`);
          await setupWebhook(aqRoot, project.repo);
        }
      }
      if (projects.length === 0 || projects.every((p: { repo: string }) => p.repo === "owner/repo-name")) {
        console.log("   config.yml의 projects 섹션에 대상 프로젝트를 등록하세요");
        console.log("   등록 후: aqm setup-webhook --repo <owner/repo> 로 webhook을 연결합니다");
        console.log("   (폴링 모드 사용 시 webhook 등록 불필요)");
      }
    } catch {
      console.log("   config.yml 파싱 실패 — webhook 수동 등록 필요");
    }
  } else {
    console.log("   config.yml 또는 smee URL 없음 — webhook 수동 등록 필요");
  }
  console.log("");

  // 6. Print next steps
  console.log("=== Setup 완료 ===\n");
  console.log("다음 단계:");
  console.log("  1. config.yml 수정 → projects 섹션에 대상 프로젝트 추가");
  console.log("  2. aqm start                    ← 웹훅 서버 시작");
  console.log("     aqm start --mode polling     ← 폴링 모드 (webhook 불필요)");
  console.log("");
  console.log("사용법:");
  console.log("  aqm run --issue <번호> --repo <owner/repo>   수동 실행");
  console.log("  aqm doctor                                   환경 점검");
  console.log("  aqm status                                   상태 확인");
  console.log("  aqm help                                     전체 명령어");
  console.log("");
}

export async function setupWebhook(aqRoot: string, repo: string): Promise<void> {
  console.log(`\nGitHub Webhook 등록: ${repo}\n`);

  const envPath = resolve(aqRoot, ".env");
  if (!existsSync(envPath)) {
    console.error(".env 파일이 없습니다. 먼저 'setup'을 실행하세요.");
    process.exit(1);
  }

  const envContent = readFileSync(envPath, "utf-8");
  const secret = envContent.match(/GITHUB_WEBHOOK_SECRET=(.+)/)?.[1]?.trim();
  const smeeUrl = envContent.match(/SMEE_URL=(.+)/)?.[1]?.trim();

  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET이 설정되지 않았습니다.");
    process.exit(1);
  }
  if (!smeeUrl) {
    console.error("SMEE_URL이 설정되지 않았습니다.");
    process.exit(1);
  }

  // Check if webhook already exists
  const listResult = await runCli("gh", ["api", `repos/${repo}/hooks`, "--jq", ".[].config.url"], { timeout: 10000 });
  if (listResult.stdout.includes(smeeUrl)) {
    console.log("Webhook 이미 등록되어 있습니다.");
    return;
  }

  // Create webhook
  const payload = JSON.stringify({
    config: { url: smeeUrl, content_type: "json", secret },
    events: ["issues"],
    active: true,
  });

  const createResult = await runCli("gh", ["api", `repos/${repo}/hooks`, "--method", "POST", "--input", "-"], { timeout: 10000, stdin: payload });

  if (createResult.exitCode === 0) {
    console.log("Webhook 등록 완료!");
    console.log(`  URL: ${smeeUrl}`);
    console.log(`  Events: issues`);
  } else {
    console.error(`Webhook 등록 실패: ${createResult.stderr}`);
  }
}

async function checkPrerequisite(cmd: string, args: string[], name: string): Promise<void> {
  const result = await runCli(cmd, args, { timeout: 10000 });
  if (result.exitCode !== 0) {
    console.error(`   ${name} — 설치 또는 인증이 필요합니다`);
    process.exit(1);
  }
  console.log(`   ${name}`);
}

/**
 * 인터랙티브 설정 위자드 실행
 * @returns Promise<WizardAnswers> 사용자 입력 결과
 */
export async function runInteractiveWizard(): Promise<WizardAnswers> {
  console.log("\n=== 프로젝트 설정 위자드 ===\n");

  // 1. 저장소 입력 및 검증
  let repo = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    repo = await askQuestion("GitHub 저장소를 입력하세요 (예: octocat/Hello-World): ");
    const validation = validateRepoFormat(repo);

    if (validation.isValid) {
      break;
    }

    handleValidationError(validation, "저장소");
  }

  // 2. 로컬 경로 입력 및 검증 + 클론 제안
  let path = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    path = await askQuestion("로컬 경로를 입력하세요 (예: /home/user/projects/my-repo): ");
    const validation = validateLocalPath(path);

    if (validation.isValid) {
      break;
    }

    // 경로가 존재하지 않는 경우 클론 제안
    if (validation.error?.includes("존재하지 않습니다")) {
      console.log(`\n❌ ${validation.error}`);

      const cloneSuggestion = await suggestClone(repo);
      if (cloneSuggestion.isValid && cloneSuggestion.suggestion) {
        console.log(`\n💡 클론 제안:\n${cloneSuggestion.suggestion}\n`);
      }

      const shouldContinue = await askConfirm("다른 경로를 입력하시겠습니까?");
      if (!shouldContinue) {
        console.log("설정을 중단합니다.");
        process.exit(0);
      }
    } else {
      handleValidationError(validation, "로컬 경로");
    }
  }

  // 3. 파이프라인 모드 선택
  const modeChoices = ["code (코딩 작업)", "content (문서/콘텐츠 작업)"];
  const modeIndex = await askChoice("파이프라인 모드를 선택하세요:", modeChoices);
  const mode: PipelineMode = modeIndex === 0 ? "code" : "content";

  console.log("\n✅ 설정 완료!");
  console.log(`   저장소: ${repo}`);
  console.log(`   경로: ${path}`);
  console.log(`   모드: ${mode}\n`);

  return { repo, path, mode };
}
