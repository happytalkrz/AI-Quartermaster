import { DEFAULT_CONFIG } from "../defaults.js";
import type { ConfigSource, LoadContext, SourceResult } from "./types.js";

/**
 * ManagedSource — DEFAULT_CONFIG를 제공하는 최하위 우선순위 소스 (priority: 0)
 */
export class ManagedSource implements ConfigSource {
  readonly name = "managed";

  load(_context: LoadContext): SourceResult {
    return DEFAULT_CONFIG as unknown as Record<string, unknown>;
  }
}
