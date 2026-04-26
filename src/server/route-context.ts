import type { Context } from "hono";
import type { JobStore } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import type { ConfigProvider } from "../config/config-provider.js";
import type { PatternStore } from "../learning/pattern-store.js";
import type { SSEManager } from "./sse-manager.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";

/**
 * 대시보드 라우트 핸들러가 공유하는 의존성 컨테이너.
 *
 * Plan C #C5에서 정의되며, 실제 `createDashboardRoutes` 시그니처 적용은 #C9·#C12에서
 * 라우트 파일 분할과 함께 진행한다. 본 인터페이스는 그 사전 계약이다.
 */
export interface DashboardContext {
  store: JobStore;
  queue: JobQueue;
  sseManager: SSEManager;
  configProvider: ConfigProvider;
  patternStore?: PatternStore;
  /** AQM 설치 루트(=AQM_HOME 또는 ~/.ai-quartermaster) — 라우트 핸들러가 데이터/로그 경로 조립에 사용. */
  rootDir: string;
  /** insecure 환경에서 mutation 차단용 플래그. */
  readOnly: boolean;
}

/**
 * 라우트 핸들러에서 던져진 예외를 표준 JSON 에러 응답으로 변환한다.
 * `sanitizeErrorMessage(getErrorMessage(...))` 42회 반복 패턴의 단일화 헬퍼.
 *
 * @param c Hono Context
 * @param error catch 블록의 unknown 에러
 * @param prefix 사용자 노출용 접두 메시지(예: "Failed to fetch jobs")
 * @param status HTTP 상태 코드 (기본 500)
 */
export function safeError(
  c: Context,
  error: unknown,
  prefix: string,
  status: number = 500
): Response {
  const message = sanitizeErrorMessage(getErrorMessage(error));
  // Hono의 status 파라미터는 ContentfulStatusCode union이지만, safeError는
  // 일반 number를 받고 호출부 편의성을 우선한다 (4xx/5xx 범위 가정).
  return c.json({ error: `${prefix}: ${message}` }, status as Parameters<typeof c.json>[1]);
}
