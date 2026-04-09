import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { deepMerge } from "../loader.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import type { ConfigSource } from "./types.js";

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
      const parsed = parseYaml(content);
      config = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (err: unknown) {
      throw new Error(`Failed to parse config.yml: ${getErrorMessage(err)}`);
    }

    if (existsSync(localConfigPath)) {
      try {
        const localContent = readFileSync(localConfigPath, "utf-8");
        const localParsed = parseYaml(localContent);
        if (localParsed !== null && typeof localParsed === "object" && !Array.isArray(localParsed)) {
          config = deepMerge(config, localParsed as Record<string, unknown>);
        }
      } catch (err: unknown) {
        throw new Error(`Failed to parse config.local.yml: ${getErrorMessage(err)}`);
      }
    }

    return config;
  }
}
