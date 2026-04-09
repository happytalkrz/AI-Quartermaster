import { readFileSync, existsSync } from "fs";
import { deepMerge, parseYamlSafely } from "../loader.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import type { ConfigSource } from "./types.js";

/**
 * YAML 에러를 래핑: 탭 에러(친화적 메시지)는 그대로, 다른 에러는 파일명 접두사 추가
 */
function wrapYamlError(err: unknown, fileName: string): Error {
  if (err instanceof Error && err.message.includes('YAML 설정 파일에 탭 문자가 포함되어 있습니다')) {
    return err;
  }
  return new Error(`Failed to parse ${fileName}: ${getErrorMessage(err)}`);
}

/**
 * Project source — config.yml + config.local.yml 로드
 * config.yml은 필수, config.local.yml은 선택적
 */
export class ProjectSource implements ConfigSource {
  readonly name = "project";
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  load(): Record<string, unknown> {
    const baseConfigPath = `${this.projectRoot}/config.yml`;
    const localConfigPath = `${this.projectRoot}/config.local.yml`;

    if (!existsSync(baseConfigPath)) {
      throw new Error(`config.yml not found at ${baseConfigPath}`);
    }

    let config: Record<string, unknown>;
    try {
      const content = readFileSync(baseConfigPath, "utf-8");
      const parsed = parseYamlSafely(content, baseConfigPath);
      config = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (err: unknown) {
      throw wrapYamlError(err, "config.yml");
    }

    if (existsSync(localConfigPath)) {
      try {
        const localContent = readFileSync(localConfigPath, "utf-8");
        const localParsed = parseYamlSafely(localContent, localConfigPath);
        if (localParsed !== null && typeof localParsed === "object" && !Array.isArray(localParsed)) {
          config = deepMerge(config, localParsed as Record<string, unknown>);
        }
      } catch (err: unknown) {
        throw wrapYamlError(err, "config.local.yml");
      }
    }

    return config;
  }
}
