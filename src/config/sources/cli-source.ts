import type { ConfigSource, LoadContext } from "./types.js";

/**
 * CLI 옵션 오버라이드를 처리하는 설정 소스.
 * LoadContext.configOverrides를 partial config로 반환한다.
 */
export class CliSource implements ConfigSource {
  readonly name = "cli";

  load(context: LoadContext): Record<string, unknown> | null {
    if (!context.configOverrides || Object.keys(context.configOverrides).length === 0) {
      return null;
    }
    return context.configOverrides;
  }
}
