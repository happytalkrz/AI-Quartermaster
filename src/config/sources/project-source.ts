import { readFileSync, existsSync } from "fs";
import type { ConfigSource, LoadContext, SourceResult } from "./types.js";
import { parseYamlSafely, isRecord, deepMerge } from "./types.js";

/**
 * ProjectSource — config.yml + config.local.yml 로딩
 *
 * config.yml은 필수 파일이며 없으면 에러를 던진다.
 * config.local.yml은 선택 파일이며 존재할 경우 config.yml 위에 병합된다.
 */
export class ProjectSource implements ConfigSource {
  readonly name = "project";

  load(context: LoadContext): SourceResult {
    const { projectRoot } = context;
    const baseConfigPath = `${projectRoot}/config.yml`;
    const localConfigPath = `${projectRoot}/config.local.yml`;

    if (!existsSync(baseConfigPath)) {
      throw new Error(`config.yml not found at ${baseConfigPath}`);
    }

    const baseRaw = parseYamlSafely(readFileSync(baseConfigPath, "utf-8"), baseConfigPath);
    let result: Record<string, unknown> = isRecord(baseRaw) ? baseRaw : {};

    if (existsSync(localConfigPath)) {
      const localRaw = parseYamlSafely(readFileSync(localConfigPath, "utf-8"), localConfigPath);
      result = deepMerge<Record<string, unknown>>(result, localRaw);
    }

    return result;
  }
}
