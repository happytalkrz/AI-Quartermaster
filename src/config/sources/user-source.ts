import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import type { ConfigSource } from "./types.js";

/**
 * User source — ~/.aqm/config.yml 로드
 * 파일이 없으면 빈 객체 반환 (선택적 소스)
 */
export class UserSource implements ConfigSource {
  readonly name = "user";
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? `${homedir()}/.aqm/config.yml`;
  }

  load(): Record<string, unknown> {
    if (!existsSync(this.configPath)) {
      return {};
    }

    const logger = getLogger();
    try {
      const content = readFileSync(this.configPath, "utf-8");
      const parsed = parseYaml(content);
      if (parsed === null || parsed === undefined) return {};
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        logger.warn(`User config at ${this.configPath} is not an object, skipping`);
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch (err: unknown) {
      logger.warn(`Failed to load user config from ${this.configPath}: ${getErrorMessage(err)}`);
      return {};
    }
  }
}
