import type { ConfigSource } from "./types.js";

/**
 * CLI 오버라이드 소스 — --set key=value 형태로 전달된 configOverrides 처리
 */
export class CliSource implements ConfigSource {
  readonly name = "cli";

  constructor(private readonly overrides: Record<string, unknown>) {}

  load(): Record<string, unknown> {
    return this.overrides;
  }
}
