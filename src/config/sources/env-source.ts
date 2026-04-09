import { parseEnvVars } from "../env-parser.js";
import type { ConfigSource, LoadContext, SourceResult } from "./types.js";

/**
 * AQM_* 환경변수로부터 설정을 로드하는 소스.
 * 내부적으로 기존 parseEnvVars를 호출한다.
 */
export class EnvSource implements ConfigSource {
  readonly name = "env";

  load(context: LoadContext): SourceResult {
    const env = context.envVars ?? process.env;
    const result = parseEnvVars(env);
    return Object.keys(result).length > 0 ? result : null;
  }
}
