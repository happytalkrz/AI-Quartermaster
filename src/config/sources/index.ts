import { deepMerge } from "../loader.js";
import { validateConfig } from "../validator.js";
import { DEFAULT_CONFIG } from "../defaults.js";
import type { ConfigSource, ConfigSources, MergeResult, SourceName } from "./types.js";
import { SOURCE_PRIORITY_ORDER } from "./types.js";

export type { ConfigSource, ConfigSources, MergeResult, SourceName };
export { SOURCE_PRIORITY_ORDER };

/**
 * 5단계 소스를 우선순위 순서로 병합하여 최종 config를 반환
 * 우선순위 (낮음→높음): Managed → User → Project → CLI → Env
 */
export async function mergeSources(sources: ConfigSources): Promise<MergeResult> {
  let merged: Record<string, unknown> = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  const loadedSources: SourceName[] = [];

  for (const name of SOURCE_PRIORITY_ORDER) {
    const source = sources[name];
    if (!source) continue;

    const partial = await source.load();
    merged = deepMerge(merged, partial);
    loadedSources.push(name);
  }

  const config = validateConfig(merged);
  return { config, sources: loadedSources };
}
