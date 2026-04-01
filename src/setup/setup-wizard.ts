import { existsSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { runCli } from "../utils/cli-runner.js";
import { randomBytes } from "crypto";

export async function runSetup(aqRoot: string): Promise<void> {
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
  const referencePath = resolve(aqRoot, "config.reference.yml");

  if (existsSync(configPath)) {
    console.log("   config.yml 이미 존재 (건너뜀)");
  } else if (existsSync(referencePath)) {
    copyFileSync(referencePath, configPath);
    console.log("   config.yml 생성됨 (config.reference.yml에서 복사)");
  } else {
    console.log("   config.reference.yml을 찾을 수 없습니다");
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
