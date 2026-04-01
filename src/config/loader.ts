import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { AQConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { validateConfig } from "./validator.js";

/**
 * YAML 탭 문자 에러를 사용자 친화적인 메시지로 변환
 */
function formatYamlTabError(error: unknown, filePath: string): Error {
  if (error instanceof Error &&
      error.constructor.name === 'YAMLParseError' &&
      ('code' in error && (error as any).code === 'TAB_AS_INDENT')) {
    const lineMatch = error.message.match(/line (\d+)/);
    const lineNumber = lineMatch ? lineMatch[1] : '?';

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
