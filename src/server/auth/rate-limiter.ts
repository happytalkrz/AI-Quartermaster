import { getLogger } from "../../utils/logger.js";

const logger = getLogger();

interface WindowEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export type RateLimitExceededCallback = (ip: string, count: number) => void;

export interface LoginRateLimiterOptions {
  /** Maximum number of attempts allowed per window */
  maxAttempts: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Interval for pruning expired entries in milliseconds */
  pruneIntervalMs?: number;
  /** Called when an IP exceeds the threshold */
  onExceeded?: RateLimitExceededCallback;
}

/**
 * IP 기반 sliding-window rate-limiter (대시보드 로그인 전용)
 */
export class LoginRateLimiter {
  private readonly store = new Map<string, WindowEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly onExceeded: RateLimitExceededCallback | undefined;
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: LoginRateLimiterOptions) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.onExceeded = options.onExceeded;

    const pruneIntervalMs = options.pruneIntervalMs ?? 5 * 60 * 1000;
    this.pruneTimer = setInterval(() => this.pruneExpired(), pruneIntervalMs);
    // Allow the process to exit even if the timer is still active
    this.pruneTimer.unref?.();
  }

  /**
   * 시도 기록 후 허용 여부 반환
   */
  checkAndRecord(ip: string): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(ip);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      // 새 윈도우 시작
      this.store.set(ip, { count: 1, windowStart: now });
      return { allowed: true };
    }

    entry.count += 1;

    if (entry.count > this.maxAttempts) {
      const retryAfterMs = this.windowMs - (now - entry.windowStart);
      logger.warn(`[RateLimiter] IP ${ip} exceeded login limit: ${entry.count} attempts in window`);
      this.onExceeded?.(ip, entry.count);
      return { allowed: false, retryAfterMs };
    }

    return { allowed: true };
  }

  /**
   * 성공 로그인 시 카운트 리셋
   */
  reset(ip: string): void {
    this.store.delete(ip);
  }

  /**
   * 만료된 엔트리 정리 (pruneExpiredTokens 패턴)
   */
  private pruneExpired(): void {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      if (now - entry.windowStart >= this.windowMs) {
        this.store.delete(ip);
      }
    }
  }

  /**
   * 리소스 정리 (타이머 해제)
   */
  destroy(): void {
    if (this.pruneTimer !== undefined) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }
}
