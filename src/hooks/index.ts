import type { HooksConfig } from "../types/hooks.js";
import { HookRegistry } from "./hook-registry.js";

export { HookRegistry } from "./hook-registry.js";
export { HookExecutor } from "./hook-executor.js";
export type { HookResult } from "./hook-executor.js";

/**
 * config.hooks에서 HookRegistry 인스턴스를 초기화하는 헬퍼 함수
 * @param hooksConfig - config에서 가져온 hooks 설정
 * @returns HookRegistry 인스턴스
 */
export function initializeHooks(hooksConfig?: HooksConfig): HookRegistry {
  return new HookRegistry(hooksConfig || {});
}