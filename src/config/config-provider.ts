import type { AQConfig } from "../types/config.js";

/**
 * Config 주입을 위한 최소 인터페이스.
 *
 * `loadConfig(process.cwd())` 직접 호출 대신 의존성을 주입받아 사용하기 위한 추상화.
 * `ConfigWatcher`가 기본 구현이지만, 테스트·스크립트에서 다른 소스로 교체 가능하다.
 */
export interface ConfigProvider {
  /** 현재 유효한 설정을 반환. ConfigWatcher는 내부 캐시/파일 감시로 최신 유지. */
  current(): AQConfig;
  /** 외부 시그널로 캐시를 강제 재로드. */
  refresh(): void;
}
