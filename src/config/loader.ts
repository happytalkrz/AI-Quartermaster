import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { AQConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validator.js";

export interface TryLoadConfigResult {
  config: AQConfig | null;
  error?: {
    type: 'not_found' | 'yaml_syntax' | 'validation';
    message: string;
    details?: string[];
  };
}

/**
 * YAML 탭 문자 에러를 사용자 친화적인 메시지로 변환
 */
function formatYamlTabError(error: unknown, filePath: string): Error {
  if (error instanceof Error &&
      error.constructor.name === 'YAMLParseError' &&
      (error as any).code === 'TAB_AS_INDENT') {
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
function parseYamlSafely(content: string, filePath: string): any {
  try {
    return parseYaml(content);
  } catch (error) {
    throw formatYamlTabError(error, filePath);
  }
}

// Deep merge helper - recursively merges source into target
// Arrays in source replace arrays in target (no concat)
export function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) {
    return target;
  }
  if (typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  if (typeof target !== "object" || Array.isArray(target)) {
    return source;
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = deepMerge(target[key], source[key]);
  }
  return result;
}

export function loadConfig(projectRoot: string): AQConfig {
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  let config = structuredClone(DEFAULT_CONFIG);

  if (!existsSync(baseConfigPath)) {
    throw new Error(`config.yml not found at ${baseConfigPath}`);
  }

  const baseRaw = parseYamlSafely(readFileSync(baseConfigPath, "utf-8"), baseConfigPath);
  config = deepMerge(config, baseRaw);

  if (existsSync(localConfigPath)) {
    const localRaw = parseYamlSafely(readFileSync(localConfigPath, "utf-8"), localConfigPath);
    config = deepMerge(config, localRaw);
  }

  return validateConfig(config);
}

export function tryLoadConfig(projectRoot: string): TryLoadConfigResult {
  const baseConfigPath = `${projectRoot}/config.yml`;
  const localConfigPath = `${projectRoot}/config.local.yml`;

  // Check if base config exists
  if (!existsSync(baseConfigPath)) {
    return {
      config: null,
      error: {
        type: 'not_found',
        message: `config.yml not found at ${baseConfigPath}`
      }
    };
  }

  let config = structuredClone(DEFAULT_CONFIG);

  // Try to parse base config
  try {
    const baseRaw = parseYamlSafely(readFileSync(baseConfigPath, "utf-8"), baseConfigPath);
    config = deepMerge(config, baseRaw);
  } catch (err: unknown) {
    return {
      config: null,
      error: {
        type: 'yaml_syntax',
        message: `Failed to parse config.yml: ${err instanceof Error ? err.message : 'Unknown error'}`
      }
    };
  }

  // Try to merge local config if exists
  try {
    const localRaw = parseYamlSafely(readFileSync(localConfigPath, "utf-8"), localConfigPath);
    config = deepMerge(config, localRaw);
  } catch (err: unknown) {
    // Only fail on non-ENOENT errors (file exists but can't parse)
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        config: null,
        error: {
          type: 'yaml_syntax',
          message: `Failed to parse config.local.yml: ${err.message}`
        }
      };
    }
  }

  // Try to validate config
  try {
    const validatedConfig = validateConfig(config);
    return { config: validatedConfig };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown validation error';
    const lines = message.split('\n');
    const details = lines.length > 1
      ? lines.slice(1).filter(line => line.trim())
      : undefined;

    return {
      config: null,
      error: {
        type: 'validation',
        message: lines[0] || 'Validation failed',
        details: details?.length ? details : undefined
      }
    };
  }
}
