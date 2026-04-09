import type { ConfigSource } from "./types.js";
import { parseEnvVars } from "../env-parser.js";

/**
 * 환경변수 소스 — AQM_* 환경변수를 파싱하여 config로 변환
 */
export class EnvSource implements ConfigSource {
  readonly name = "env";

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  load(): Record<string, unknown> {
    return parseEnvVars(this.env);
  }
}
