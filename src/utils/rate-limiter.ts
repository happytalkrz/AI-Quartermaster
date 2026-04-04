import { RetryConfig } from "../types/config.js";
import { getLogger } from "./logger.js";

const logger = getLogger();

/**
 * GitHub/Claude API rate limit 추적 클래스
 */
export class RateLimitTracker {
  private remaining: number = Infinity;
  private resetTime: number = 0;

  /**
   * API 응답에서 rate limit 정보 업데이트
   */
  updateFromHeaders(headers: Record<string, string>): void {
    const remaining = headers["x-ratelimit-remaining"] || headers["x-rate-limit-remaining"];
    const reset = headers["x-ratelimit-reset"] || headers["x-rate-limit-reset"];

    if (remaining) {
      this.remaining = parseInt(remaining, 10);
    }

    if (reset) {
      // Unix timestamp (seconds) to milliseconds
      this.resetTime = parseInt(reset, 10) * 1000;
    }

    logger.debug(`Rate limit updated: remaining=${this.remaining}, reset=${new Date(this.resetTime).toISOString()}`);
  }

  /**
   * API 호출 전 대기가 필요한지 판단
   */
  shouldWait(): boolean {
    if (this.remaining === Infinity) return false;
    if (this.remaining > 10) return false; // 여유분 10개 유지

    const now = Date.now();
    if (this.resetTime > now) {
      logger.warn(`Rate limit approaching: ${this.remaining} requests remaining`);
      return true;
    }

    // Reset 시간이 지났으면 갱신
    if (this.resetTime <= now) {
      this.remaining = Infinity;
      this.resetTime = 0;
    }

    return false;
  }

  /**
   * 대기 시간 계산 (milliseconds)
   */
  getWaitTime(): number {
    if (!this.shouldWait()) return 0;

    const now = Date.now();
    const waitTime = Math.max(0, this.resetTime - now + 1000); // 1초 추가 버퍼
    logger.info(`Rate limit wait time: ${waitTime}ms`);
    return waitTime;
  }

  /**
   * 현재 상태 반환 (테스트/디버깅용)
   */
  getStatus(): { remaining: number; resetTime: number } {
    return { remaining: this.remaining, resetTime: this.resetTime };
  }
}

/**
 * 지수 백오프 계산 클래스
 */
export class ExponentialBackoff {
  private attempt: number = 0;
  private readonly config: Required<RetryConfig>;

  constructor(config: RetryConfig) {
    this.config = {
      ...config,
      jitterFactor: Math.max(0, Math.min(1, config.jitterFactor)),
    } as Required<RetryConfig>;
  }

  /**
   * 다음 재시도 지연 시간 계산
   */
  nextDelay(): number {
    if (this.attempt >= this.config.maxRetries) {
      return -1; // 최대 재시도 초과
    }

    // 지수 백오프: initialDelay * 2^attempt
    const exponentialDelay = this.config.initialDelayMs * Math.pow(2, this.attempt);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // 지터 추가: ±jitterFactor 범위의 랜덤 변동
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    const finalDelay = Math.max(0, cappedDelay + jitter);

    this.attempt++;
    logger.debug(`Exponential backoff: attempt=${this.attempt}, delay=${finalDelay}ms`);

    return finalDelay;
  }

  /**
   * 재시도 상태 초기화
   */
  reset(): void {
    this.attempt = 0;
    logger.debug("Exponential backoff reset");
  }

  /**
   * 현재 재시도 횟수 반환
   */
  getAttempt(): number {
    return this.attempt;
  }
}

const RETRYABLE_MESSAGES = [
  "rate limit",
  "too many requests",
  "timeout",
  "network error",
  "connection reset",
  "econnreset",
  "prompt is too long",
  "temporarily unavailable",
];

/**
 * 재시도 가능한 에러 타입 판단
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { message?: string; code?: string; status?: number };

  // HTTP 상태 코드 기반 판단
  if (typeof err.status === "number") {
    return err.status >= 500 || err.status === 429;
  }

  // 에러 메시지 기반 판단
  const message = err.message?.toLowerCase() || "";
  return RETRYABLE_MESSAGES.some(msg => message.includes(msg));
}

/**
 * 재시도 로직이 포함된 함수 실행 헬퍼
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  context?: string
): Promise<T> {
  const backoff = new ExponentialBackoff(config);
  const contextStr = context ? `[${context}] ` : "";

  let lastError: unknown;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await operation();
      if (backoff.getAttempt() > 0) {
        logger.info(`${contextStr}Operation succeeded after ${backoff.getAttempt()} retries`);
      }
      return result;
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        logger.debug(`${contextStr}Non-retryable error: ${error}`);
        throw error;
      }

      const delay = backoff.nextDelay();
      if (delay === -1) {
        logger.error(`${contextStr}Max retries (${config.maxRetries}) exceeded`);
        throw lastError;
      }

      logger.warn(`${contextStr}Retryable error (attempt ${backoff.getAttempt()}/${config.maxRetries}): ${error}`);
      logger.info(`${contextStr}Waiting ${delay}ms before retry...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Rate limit + 지수 백오프를 결합한 안전한 API 호출 헬퍼
 */
export async function withRateLimit<T>(
  operation: () => Promise<T>,
  rateLimiter: RateLimitTracker,
  retryConfig: RetryConfig,
  context?: string
): Promise<T> {
  // Rate limit 대기
  if (rateLimiter.shouldWait()) {
    const waitTime = rateLimiter.getWaitTime();
    const contextStr = context ? `[${context}] ` : "";
    logger.info(`${contextStr}Rate limit hit, waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  // 재시도 로직과 함께 실행
  return withRetry(operation, retryConfig, context);
}