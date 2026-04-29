import type { Hono } from "hono";
import { randomUUID } from "crypto";
import type { JobStore, Job } from "../../queue/job-store.js";
import type { JobQueue } from "../../queue/job-queue.js";
import type { SSEManager } from "../sse-manager.js";

export interface SSERouteContext {
  store: JobStore;
  queue: JobQueue;
  sseManager: SSEManager;
}

const SSE_INITIAL_JOB_LIMIT = 20;
const SSE_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SSE_LOG_POLL_MS = 1000;
const SSE_EVENT_POLL_MS = 10_000;

/**
 * SSE 초기 페이로드용 잡 목록.
 * - archived 제외
 * - running/queued는 항상 포함
 * - 남은 슬롯은 최근 non-active job으로 채움 (총 SSE_INITIAL_JOB_LIMIT)
 */
function getInitialJobs(store: JobStore): Job[] {
  const active = store.list({ statuses: ["running", "queued"] });
  const remaining = Math.max(0, SSE_INITIAL_JOB_LIMIT - active.length);
  const rest = remaining > 0
    ? store.list({ statuses: ["success", "failure", "cancelled"], limit: remaining })
    : [];
  return [...active, ...rest];
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
} as const;

/**
 * SSE 라우트 등록 (Plan C #C9 — 11단계).
 *
 * 이전: dashboard-api.ts 388-489 (2 routes, ~105줄).
 *  - GET /api/jobs/:id/logs/stream — 단일 잡 로그 폴링 SSE
 *  - GET /api/events — 글로벌 잡/큐 상태 SSE
 *
 * 클라이언트 풀(SSEManager)과 인증 미들웨어는 dashboard-api.ts에 그대로 남는다.
 * 본 모듈은 라우트 핸들러만 응집한다.
 */
export function registerSSERoutes(api: Hono, ctx: SSERouteContext): void {
  const { store, queue, sseManager } = ctx;

  // 단일 잡 로그 SSE
  api.get("/api/jobs/:id/logs/stream", (c) => {
    const id = c.req.param("id");
    let lastLogCount = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = () => {
          try {
            const job = store.get(id);
            if (!job) {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Job not found" })}\n\n`));
              clearInterval(intervalId);
              try { controller.close(); } catch { /* already closed */ }
              return;
            }
            const logs = job.logs || [];
            if (logs.length > lastLogCount) {
              const newLines = logs.slice(lastLogCount);
              lastLogCount = logs.length;
              for (const line of newLines) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, status: job.status })}\n\n`));
              }
            }
            // status가 종료 상태면 done 이벤트 + 스트림 종료
            if (job.status !== "running" && job.status !== "queued") {
              controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`));
              clearInterval(intervalId);
              try { controller.close(); } catch { /* already closed */ }
            }
          } catch {
            // stream closed
          }
        };
        send();
        intervalId = setInterval(send, SSE_LOG_POLL_MS);
        setTimeout(() => {
          clearInterval(intervalId);
          try { controller.close(); } catch { /* already closed */ }
        }, SSE_MAX_DURATION_MS);
      },
      cancel() {
        clearInterval(intervalId);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  });

  // 글로벌 잡/큐 상태 SSE
  api.get("/api/events", (_c) => {
    const clientId = randomUUID();
    const encoder = new TextEncoder();
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        sseManager.addClient(controller, clientId);

        const sendInitialState = () => {
          try {
            const status = queue.getStatus();
            const data = JSON.stringify({ jobs: getInitialJobs(store), queue: status });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            // stream closed
          }
        };

        sendInitialState();

        // 실시간 이벤트가 대부분의 업데이트를 처리하므로 폴링은 fallback 용도(10초).
        intervalId = setInterval(sendInitialState, SSE_EVENT_POLL_MS);

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
          clearInterval(intervalId);
          sseManager.removeClient(clientId);
        }, SSE_MAX_DURATION_MS);
      },
      cancel() {
        clearInterval(intervalId);
        sseManager.removeClient(clientId);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  });
}
