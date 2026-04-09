import { DEFAULT_CONFIG } from "../defaults.js";
import type { ConfigSource } from "./types.js";

/**
 * Managed source — AQM 내부 기본값(DEFAULT_CONFIG)을 제공
 * 5단계 병합에서 가장 낮은 우선순위
 */
export class ManagedSource implements ConfigSource {
  readonly name = "managed";

  load(): Record<string, unknown> {
    return structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  }
}
