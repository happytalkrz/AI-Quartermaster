import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { getErrorMessage } from "../../utils/error-utils.js";

/**
 * YAML 에러 객체가 code 프로퍼티를 가지는지 확인하는 타입 가드
 */
function hasErrorCode(error: Error): error is Error & { code: string } {
  return 'code' in error && typeof (error as Error & { code: unknown }).code === 'string';
}

/**
 * YAML 탭 문자 에러를 사용자 친화적인 메시지로 변환
 */
function formatYamlTabError(error: unknown, filePath: string): Error {
  if (error instanceof Error &&
      error.constructor.name === 'YAMLParseError' &&
      hasErrorCode(error) &&
      error.code === 'TAB_AS_INDENT') {
    const lineMatch = error.message.match(/line (\d+)/);
    const lineNumber = lineMatch?.[1] ?? '?';

    const friendlyMessage = `❌ YAML 설정 파일에 탭 문자가 포함되어 있습니다.
   파일: ${filePath}
   위치: ${lineNumber}번째 줄

   해결방법: YAML 파일에서는 들여쓰기에 탭 문자를 사용할 수 없습니다. 탭 문자를 스페이스(공백)로 교체해주세요.

   예시:
   # 잘못된 예 (탭 문자 사용)
   general:
   →→projectName: "my-project"

   # 올바른 예 (스페이스 사용)
   general:
     projectName: "my-project"

   팁: 에디터에서 "공백 표시" 기능을 활성화하면 탭 문자와 스페이스를 구분할 수 있습니다.`;

    return new Error(friendlyMessage);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * YAML 파싱을 수행하되 탭 문자 에러를 친절하게 처리
 */
function parseYamlSafely(content: string, filePath: string): unknown {
  try {
    return parseYaml(content);
  } catch (error: unknown) {
    throw formatYamlTabError(error, filePath);
  }
}

export interface ProjectSourceOptions {
  projectRoot: string;
}

export interface ProjectSourceResult {
  baseConfig?: unknown;
  localConfig?: unknown;
  error?: {
    type: 'not_found' | 'yaml_syntax';
    message: string;
    file: string;
  };
}

/**
 * 프로젝트 YAML 파일들(config.yml, config.local.yml)을 로드
 */
export function loadProjectSource(options: ProjectSourceOptions): ProjectSourceResult {
  const { projectRoot } = options;
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  // Check if base config exists
  if (!existsSync(baseConfigPath)) {
    return {
      error: {
        type: 'not_found',
        message: `config.yml not found at ${baseConfigPath}`,
        file: baseConfigPath
      }
    };
  }

  let baseConfig: unknown;
  let localConfig: unknown;

  // Load base config.yml
  try {
    const baseContent = readFileSync(baseConfigPath, "utf-8");
    baseConfig = parseYamlSafely(baseContent, baseConfigPath);
  } catch (error: unknown) {
    return {
      error: {
        type: 'yaml_syntax',
        message: `Failed to parse config.yml: ${getErrorMessage(error)}`,
        file: baseConfigPath
      }
    };
  }

  // Load config.local.yml if exists
  if (existsSync(localConfigPath)) {
    try {
      const localContent = readFileSync(localConfigPath, "utf-8");
      localConfig = parseYamlSafely(localContent, localConfigPath);
    } catch (error: unknown) {
      return {
        error: {
          type: 'yaml_syntax',
          message: `Failed to parse config.local.yml: ${getErrorMessage(error)}`,
          file: localConfigPath
        }
      };
    }
  }

  return { baseConfig, localConfig };
}