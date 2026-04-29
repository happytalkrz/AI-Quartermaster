import type { Hono, Context, Next } from "hono";
import { timingSafeEqual } from "crypto";
import type { SessionManager } from "../auth/session.js";
import type { LoginRateLimiter } from "../auth/rate-limiter.js";
import { getLogger } from "../../utils/logger.js";

export interface AuthSetupContext {
  /** 미설정이면 무인증 모드 (readOnly 또는 로컬 바인드 한정 권장). */
  apiKey?: string;
  /** 서버 바인드 호스트 — 무인증+비-로컬 바인드 시 경고 출력에 사용. */
  hostname?: string;
  readOnly: boolean;
  sessionManager: SessionManager;
  loginRateLimiter?: LoginRateLimiter;
}

/**
 * 대시보드 인증 + readOnly 가드 셋업 (Plan C #C9 — 12단계).
 *
 * 이전: dashboard-api.ts 234-349 (~115줄). POST /api/auth 라우트 + 4개 미들웨어
 *      (bearerAuth/sseTokenAuth/healSseKeyAuth/readOnlyGuard)가 if/else 블록에 섞여 있었다.
 * 이후: 본 함수가 단일 진입점. dashboard-api.ts는 setupAuth(api, ctx) 한 줄로 위임.
 *
 * 동작:
 *  - apiKey 설정 시: POST /api/auth(세션 토큰 발급) + bearerAuth(/api/*) +
 *                    sseTokenAuth(/api/events, /api/jobs/:id/logs/stream) +
 *                    healSseKeyAuth(/api/doctor/heal/:id/stream)
 *  - apiKey 미설정 시:
 *    - readOnly 모드: 쓰기 엔드포인트(config/projects/jobs/update/new-issue)에 readOnlyGuard
 *    - readOnly 아님 + 로컬 바인드: 정보 로그
 *    - readOnly 아님 + 비-로컬 바인드: 보안 위험 경고 로그
 */
export function setupAuth(api: Hono, ctx: AuthSetupContext): void {
  const { apiKey, hostname, readOnly, sessionManager, loginRateLimiter } = ctx;

  if (apiKey) {
    // POST /api/auth — Bearer key를 짧은 수명 세션 토큰으로 교환
    api.post("/api/auth", (c) => {
      const ip =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        ((c.env as Record<string, unknown> | undefined)?.["remoteAddress"] as string | undefined) ??
        "unknown";

      const rateLimitCheck = loginRateLimiter?.checkAndRecord(ip);
      if (rateLimitCheck && !rateLimitCheck.allowed) {
        const retryAfterSec = Math.ceil((rateLimitCheck.retryAfterMs ?? 900_000) / 1000);
        getLogger().warn(`[Auth] Rate limit exceeded for IP ${ip}`);
        return c.json(
          { error: "Too Many Requests" },
          429,
          { "Retry-After": String(retryAfterSec) }
        );
      }

      const auth = c.req.header("Authorization");
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      loginRateLimiter?.reset(ip);
      const { token, expiresIn } = sessionManager.createToken();
      return c.json({ token, expiresIn });
    });

    // Bearer 헤더 미들웨어 — 일반 (non-SSE) /api/* 라우트
    // Deny-by-default: 공용 + SSE 경로 외 모든 요청에 인증 요구
    const bearerAuth = async (c: Context, next: Next) => {
      const path = c.req.path;
      if (path === "/api/auth") {
        await next();
        return;
      }
      if (
        path === "/api/events" ||
        /^\/api\/jobs\/[^/]+\/logs\/stream$/.test(path) ||
        /^\/api\/doctor\/heal\/[^/]+\/stream$/.test(path)
      ) {
        await next();
        return;
      }
      const auth = c.req.header("Authorization");
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/*", bearerAuth);

    // SSE 엔드포인트 — ?token= 쿼리 파람으로 짧은 수명 세션 토큰 검증
    const sseTokenAuth = async (c: Context, next: Next) => {
      const token = c.req.query("token");
      if (!token || !sessionManager.validate(token)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/events", sseTokenAuth);
    api.use("/api/jobs/:id/logs/stream", sseTokenAuth);

    // Doctor heal SSE — EventSource는 헤더를 못 보내므로 ?key= 쿼리 파람으로 raw API key 검증
    const healSseKeyAuth = async (c: Context, next: Next) => {
      const key = c.req.query("key");
      if (!key) return c.json({ error: "Unauthorized" }, 401);
      const expected = Buffer.from(apiKey);
      const actual = Buffer.from(key);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };
    api.use("/api/doctor/heal/:id/stream", healSseKeyAuth);
  } else {
    // apiKey 미설정 — 바인드 호스트와 readOnly 여부에 따라 분기
    const isLocalBind = !hostname || hostname === "127.0.0.1" || hostname === "localhost";

    if (readOnly) {
      // readOnly 모드: 쓰기 엔드포인트에 403 반환
      const readOnlyGuard = async (c: Context, next: Next) => {
        if (c.req.method !== "GET" && c.req.method !== "HEAD") {
          return c.json({ error: "Forbidden: dashboard is in read-only mode" }, 403);
        }
        await next();
      };
      api.use("/api/config", readOnlyGuard);
      api.use("/api/projects", readOnlyGuard);
      api.use("/api/projects/*", readOnlyGuard);
      api.use("/api/jobs/*", readOnlyGuard);
      api.use("/api/update", readOnlyGuard);
      api.use("/api/new-issue", readOnlyGuard);
      getLogger().info(
        "Dashboard is running in read-only mode. Write endpoints are disabled." +
        (!isLocalBind ? " Non-local bind is permitted in read-only mode." : "")
      );
    } else if (isLocalBind) {
      getLogger().info(
        "Dashboard API key is not configured. All endpoints are accessible without authentication."
      );
    } else {
      getLogger().warn(
        "Dashboard API key is not configured. All endpoints are accessible without authentication. " +
        "Non-local bind without API key is a security risk."
      );
    }
  }
}
