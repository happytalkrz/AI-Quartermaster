import { existsSync } from "fs";
import { resolve } from "path";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * GitHub 저장소 형식을 검증합니다 (owner/repo)
 * @param input 사용자 입력 저장소 이름
 * @returns 검증 결과
 */
export function validateRepoFormat(input: string): ValidationResult {
  // 빈 문자열 체크
  if (!input || input.trim() === '') {
    return {
      isValid: false,
      error: "저장소 이름을 입력해주세요.",
      suggestion: "예시: octocat/Hello-World"
    };
  }

  const trimmed = input.trim();

  // 슬래시 개수 확인
  const slashCount = (trimmed.match(/\//g) || []).length;
  if (slashCount !== 1) {
    return {
      isValid: false,
      error: "저장소 형식은 'owner/repo' 형태여야 합니다.",
      suggestion: "예시: octocat/Hello-World"
    };
  }

  // owner와 repo 분리
  const [owner, repo] = trimmed.split('/');

  // owner 검증
  if (!owner || owner.trim() === '') {
    return {
      isValid: false,
      error: "소유자 이름이 비어있습니다.",
      suggestion: "예시: octocat/Hello-World"
    };
  }

  // repo 검증
  if (!repo || repo.trim() === '') {
    return {
      isValid: false,
      error: "저장소 이름이 비어있습니다.",
      suggestion: "예시: octocat/Hello-World"
    };
  }

  // GitHub 저장소 이름 규칙 기본 검증
  const validRepoName = /^[a-zA-Z0-9._-]+$/;
  const validOwnerName = /^[a-zA-Z0-9._-]+$/;

  if (!validOwnerName.test(owner.trim())) {
    return {
      isValid: false,
      error: "소유자 이름에 허용되지 않은 문자가 포함되어 있습니다.",
      suggestion: "영문자, 숫자, 점(.), 하이픈(-), 언더스코어(_)만 사용 가능합니다."
    };
  }

  if (!validRepoName.test(repo.trim())) {
    return {
      isValid: false,
      error: "저장소 이름에 허용되지 않은 문자가 포함되어 있습니다.",
      suggestion: "영문자, 숫자, 점(.), 하이픈(-), 언더스코어(_)만 사용 가능합니다."
    };
  }

  return { isValid: true };
}

/**
 * 로컬 경로가 존재하는지 확인합니다
 * @param path 검증할 경로
 * @returns 검증 결과
 */
export function validateLocalPath(path: string): ValidationResult {
  // 빈 문자열 체크
  if (!path || path.trim() === '') {
    return {
      isValid: false,
      error: "경로를 입력해주세요.",
      suggestion: "예시: /home/user/projects/my-repo"
    };
  }

  const trimmedPath = path.trim();

  // 절대 경로로 변환
  const absolutePath = resolve(trimmedPath);

  // 경로 존재 확인
  if (!existsSync(absolutePath)) {
    return {
      isValid: false,
      error: `경로가 존재하지 않습니다: ${absolutePath}`,
      suggestion: "존재하는 디렉토리 경로를 입력하거나, 먼저 디렉토리를 생성해주세요."
    };
  }

  return { isValid: true };
}

/**
 * GitHub CLI를 통한 저장소 클론을 제안합니다
 * @param repo 저장소 이름 (owner/repo 형식)
 * @returns 클론 제안 결과
 */
export async function suggestClone(repo: string): Promise<ValidationResult> {
  try {
    // gh CLI 설치 확인
    const ghResult = await runCli("gh", ["--version"], { timeout: 5000 });

    if (ghResult.exitCode !== 0) {
      return {
        isValid: false,
        error: "GitHub CLI (gh)가 설치되지 않았습니다.",
        suggestion: "GitHub CLI를 설치하고 'gh auth login'으로 인증한 후 다시 시도해주세요.\n설치: https://cli.github.com/"
      };
    }

    // gh 인증 상태 확인
    const authResult = await runCli("gh", ["auth", "status"], { timeout: 5000 });

    if (authResult.exitCode !== 0) {
      return {
        isValid: false,
        error: "GitHub CLI 인증이 필요합니다.",
        suggestion: "'gh auth login'을 실행하여 GitHub에 로그인한 후 다시 시도해주세요."
      };
    }

    // 클론 명령어 제안
    const cloneSuggestion = `다음 명령어로 저장소를 클론할 수 있습니다:
  gh repo clone ${repo}

또는 Git으로 직접 클론:
  git clone https://github.com/${repo}.git`;

    return {
      isValid: true,
      suggestion: cloneSuggestion
    };

  } catch (error: unknown) {
    return {
      isValid: false,
      error: `GitHub CLI 확인 중 오류가 발생했습니다: ${getErrorMessage(error)}`,
      suggestion: "GitHub CLI가 올바르게 설치되었는지 확인해주세요."
    };
  }
}

/**
 * 검증 실패 시 재입력을 유도하는 헬퍼 함수
 * @param validationResult 검증 결과
 * @param fieldName 필드 이름 (사용자에게 표시)
 */
export function handleValidationError(validationResult: ValidationResult, fieldName: string): void {
  if (!validationResult.isValid) {
    console.log(`\n❌ ${fieldName} 검증 실패: ${validationResult.error}`);

    if (validationResult.suggestion) {
      console.log(`💡 제안: ${validationResult.suggestion}`);
    }

    console.log("\n다시 입력해주세요.\n");
  }
}

/**
 * 유효한 입력을 받을 때까지 반복하는 검증 루프
 * @param prompt 사용자에게 표시할 프롬프트 메시지
 * @param validator 검증 함수
 * @param fieldName 필드 이름 (오류 메시지용)
 * @returns Promise<string> 유효한 입력값
 */
export async function validateWithRetry(
  _prompt: string,
  _validator: (input: string) => ValidationResult | Promise<ValidationResult>,
  _fieldName: string
): Promise<string> {
  // 실제 입력 받기는 setup-wizard.ts에서 구현될 예정
  // 여기서는 검증 로직만 제공
  throw new Error("validateWithRetry는 setup-wizard.ts에서 readline과 함께 구현되어야 합니다.");
}