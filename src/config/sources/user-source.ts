import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ConfigSource, LoadContext, SourceResult } from "./types.js";
import { isRecord, parseYamlSafely } from "./types.js";
import { getErrorMessage } from "../../utils/error-utils.js";

/**
 * 사용자 전역 설정 소스 (~/.aqm/config.yml)
 * 파일이 없으면 null 반환, 있으면 YAML 파싱하여 partial config 반환.
 */
export class UserSource implements ConfigSource {
  readonly name = "user";

  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? join(homedir(), ".aqm", "config.yml");
  }

  load(_context: LoadContext): SourceResult {
    if (!existsSync(this.configPath)) {
      return null;
    }

    let content: string;
    try {
      content = readFileSync(this.configPath, "utf-8");
    } catch (err: unknown) {
      throw new Error(`사용자 설정 파일 읽기 실패 (${this.configPath}): ${getErrorMessage(err)}`);
    }

    const parsed = parseYamlSafely(content, this.configPath);

    if (parsed === null || parsed === undefined) {
      return null;
    }

    if (!isRecord(parsed)) {
      throw new Error(`사용자 설정 파일 형식 오류 (${this.configPath}): YAML 최상위 값은 객체여야 합니다.`);
    }

    return parsed;
  }
}
