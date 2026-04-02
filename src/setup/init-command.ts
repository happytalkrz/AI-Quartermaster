import { resolve } from "path";
import { initProject, detectGitInfo } from "../config/loader.js";
import { InitCommandOptions } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

/**
 * aqm init 명령 구현
 * 현재 프로젝트를 AI-Quartermaster에 등록
 */
export async function runInitCommand(aqRoot: string, options: InitCommandOptions = {}): Promise<void> {
  const logger = getLogger();
  const cwd = process.cwd();

  console.log("\n=== AI Quartermaster Init ===\n");

  try {
    // 1. Git 정보 자동 감지 (dry-run에서도 실행)
    console.log("1. Git 정보 감지...");
    const gitInfo = await detectGitInfo(cwd);

    if (gitInfo.error) {
      console.error(`   ❌ ${gitInfo.error}`);
      process.exit(1);
    }

    const detectedRepo = options.repo || gitInfo.repo;
    const detectedPath = options.path || cwd;
    const detectedBaseBranch = options.baseBranch || gitInfo.baseBranch;

    if (!detectedRepo) {
      console.error("   ❌ GitHub 저장소를 감지할 수 없습니다.");
      console.error("      git remote가 설정되어 있는지 확인하거나 --repo 옵션을 사용하세요.");
      console.error("");
      console.error("   예시: aqm init --repo owner/repo-name");
      process.exit(1);
    }

    console.log(`   ✓ 저장소: ${detectedRepo}`);
    console.log(`   ✓ 경로: ${detectedPath}`);
    console.log(`   ✓ 기본 브랜치: ${detectedBaseBranch}`);
    console.log("");

    // 2. 설정 정보 표시
    console.log("2. 등록할 프로젝트 정보:");
    console.log(`   저장소: ${detectedRepo}`);
    console.log(`   경로: ${detectedPath}`);
    if (detectedBaseBranch) {
      console.log(`   기본 브랜치: ${detectedBaseBranch}`);
    }
    if (options.mode) {
      console.log(`   파이프라인 모드: ${options.mode}`);
    }
    console.log("");

    // 3. Dry run 처리
    if (options.dryRun) {
      console.log("🔍 Dry run 모드 - 실제 변경사항은 적용되지 않습니다.");
      console.log("");
      console.log("다음 작업이 수행될 예정입니다:");
      console.log(`   - config.yml에 프로젝트 '${detectedRepo}' 추가`);
      console.log(`   - 경로: ${detectedPath}`);
      if (detectedBaseBranch) {
        console.log(`   - 기본 브랜치: ${detectedBaseBranch}`);
      }
      if (options.mode) {
        console.log(`   - 파이프라인 모드: ${options.mode}`);
      }
      console.log("");
      console.log("실제 적용하려면 --dry-run 옵션을 제거하고 다시 실행하세요.");
      return;
    }

    // 4. 실제 등록 수행
    console.log("3. config.yml 업데이트...");

    await initProject(aqRoot, {
      repo: detectedRepo,
      path: detectedPath,
      baseBranch: detectedBaseBranch,
      mode: options.mode,
      force: options.force,
    });

    console.log(`   ✓ 프로젝트 '${detectedRepo}' 등록 완료`);
    console.log("");

    // 5. 다음 단계 안내
    console.log("=== Init 완료 ===\n");
    console.log("다음 단계:");
    console.log("  1. aqm doctor                    ← 환경 점검");
    console.log("  2. aqm start                     ← 웹훅 서버 시작");
    console.log("     aqm start --mode polling      ← 폴링 모드 (webhook 불필요)");
    console.log("");
    console.log("사용법:");
    console.log(`  aqm run --issue <번호> --repo ${detectedRepo}     수동 실행`);
    console.log("  aqm status                                         상태 확인");
    console.log("  aqm help                                           전체 명령어");
    console.log("");

  } catch (error) {
    logger.error(`Init 실패: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`\n❌ 오류: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * aqm init 명령 옵션 파싱
 */
export function parseInitOptions(args: string[]): InitCommandOptions & { help?: boolean } {
  const options: InitCommandOptions & { help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--repo":
        if (nextArg) {
          options.repo = nextArg;
          i++;
        }
        break;
      case "--path":
        if (nextArg) {
          options.path = resolve(nextArg);
          i++;
        }
        break;
      case "--base-branch":
        if (nextArg) {
          options.baseBranch = nextArg;
          i++;
        }
        break;
      case "--mode":
        if (nextArg && (nextArg === "code" || nextArg === "content")) {
          options.mode = nextArg;
          i++;
        }
        break;
      case "--force":
        options.force = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
    }
  }

  return options;
}

/**
 * aqm init 도움말 출력
 */
export function printInitHelp(): void {
  console.log(`
aqm init - 현재 프로젝트를 AI-Quartermaster에 등록

Usage:
  aqm init [options]

Options:
  --repo <owner/repo>     GitHub 저장소 (자동 감지 재정의)
  --path <path>          로컬 경로 (기본: 현재 디렉토리)
  --base-branch <branch> 기본 브랜치 (자동 감지 재정의)
  --mode <mode>          파이프라인 모드 (code | content)
  --force               기존 프로젝트 설정 덮어쓰기
  --dry-run             실제 변경 없이 미리보기
  --help, -h            이 도움말 표시

Examples:
  aqm init                              # 현재 디렉토리 자동 감지하여 등록
  aqm init --repo owner/repo            # 저장소 직접 지정
  aqm init --mode content               # 컨텐츠 파이프라인 모드로 등록
  aqm init --force                      # 기존 설정 덮어쓰기
  aqm init --dry-run                    # 미리보기 모드

Notes:
  - Git 저장소 내에서 실행해야 합니다
  - config.yml이 없으면 최소 구조로 생성됩니다
  - config.yml이 있으면 기존 포맷을 보존하며 projects 배열에 추가됩니다
  `);
}