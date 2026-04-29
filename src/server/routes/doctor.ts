import type { Hono } from "hono";
import { safeError } from "../route-context.js";
import { runAllChecks } from "../../doctor/checks.js";
import { healLevel1, healLevel2, writeToActiveHealProcess } from "../../doctor/heal.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import { sanitizeErrorMessage } from "../../utils/error-sanitizer.js";

/**
 * /api/doctor/* 라우트 등록 (Plan C #C9 — 8단계).
 *
 * 이전: dashboard-api.ts 977-1052 (4 routes, ~75줄).
 * 의존성이 doctor 모듈에 한정되어 ctx 인자가 없다.
 */
export function registerDoctorRoutes(api: Hono): void {
  api.get("/api/doctor/run", async (c) => {
    try {
      const checks = await runAllChecks();
      return c.json({ checks });
    } catch (error: unknown) {
      return safeError(c, error, "Doctor run failed");
    }
  });

  // POST /api/doctor/heal/stdin — stdin bridge for active Level2 process.
  // Declared BEFORE :id route so "stdin" is not captured as checkId.
  api.post("/api/doctor/heal/stdin", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const input = typeof body?.input === "string" ? body.input : null;
    if (input === null) {
      return c.json({ error: "Missing 'input' field" }, 400);
    }
    const ok = writeToActiveHealProcess(input);
    if (!ok) {
      return c.json({ error: "No active heal process" }, 404);
    }
    return c.json({ ok: true });
  });

  // POST /api/doctor/heal/:id — Level1 auto-fix (runs autoFixCommand, waits for completion)
  api.post("/api/doctor/heal/:id", async (c) => {
    const checkId = c.req.param("id");
    try {
      const result = await healLevel1(checkId);
      return c.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
    } catch (error: unknown) {
      return c.json({ error: sanitizeErrorMessage(getErrorMessage(error)) }, 400);
    }
  });

  // GET /api/doctor/heal/:id/stream — Level2 SSE streaming (spawn + stdout/stderr bridge)
  api.get("/api/doctor/heal/:id/stream", (c) => {
    const checkId = c.req.param("id");
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        healLevel2(checkId, {
          onData(chunk) {
            try {
              for (const line of chunk.split("\n")) {
                if (line.length > 0) {
                  controller.enqueue(encoder.encode(`data: ${line}\n\n`));
                }
              }
            } catch { /* stream closed */ }
          },
          onDone() {
            try {
              controller.enqueue(encoder.encode(`event: done\ndata: \n\n`));
              controller.close();
            } catch { /* already closed */ }
          },
          onFail(msg) {
            try {
              controller.enqueue(encoder.encode(`event: fail\ndata: ${msg}\n\n`));
              controller.close();
            } catch { /* already closed */ }
          },
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });
}
