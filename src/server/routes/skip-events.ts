import type { Hono } from "hono";
import type { JobStore } from "../../queue/job-store.js";
import { safeError } from "../route-context.js";
import { GetSkipEventsQuerySchema, formatZodError } from "../../types/api.js";

export interface SkipEventsRouteContext {
  store: JobStore;
  readOnly: boolean;
}

/**
 * /api/skip-events/* 라우트 등록 (Plan C #C9 — 10단계).
 *
 * 이전: dashboard-api.ts 395-491 (3 routes, ~95줄).
 * 동일 이슈+reasonCode 중복 축약을 위한 그룹 뷰와 flat 뷰를 함께 제공한다.
 */
export function registerSkipEventsRoutes(api: Hono, ctx: SkipEventsRouteContext): void {
  const { store, readOnly } = ctx;

  // Skip events stats (reasonCode별 집계)
  api.get("/api/skip-events/stats", (c) => {
    try {
      const repo = c.req.query("repo");
      const allEvents = store.listSkipEvents(repo ? { repo } : undefined);

      const reasonCodeCounts: Record<string, number> = {};
      for (const event of allEvents) {
        reasonCodeCounts[event.reasonCode] = (reasonCodeCounts[event.reasonCode] ?? 0) + 1;
      }

      const stats = Object.entries(reasonCodeCounts)
        .map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((a, b) => b.count - a.count);

      return c.json({ total: allEvents.length, stats });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch skip event stats");
    }
  });

  // List skip events (flat 또는 issueNumber+repo+reasonCode 그룹)
  api.get("/api/skip-events", (c) => {
    try {
      const groupParam = c.req.query("group");
      const queryParams = {
        repo: c.req.query("repo"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
        group: groupParam === "true" ? true : groupParam === "false" ? false : undefined,
      };

      const parseResult = GetSkipEventsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: formatZodError(parseResult.error),
        }, 400);
      }

      const { repo, limit, offset, group } = parseResult.data;

      // 그룹 뷰: 동일 이슈+reasonCode 중복 축약 (기본 대시보드 뷰)
      if (group) {
        const { groups, totalGroups } = store.listSkipEventsGrouped({ repo, limit, offset });
        const start = offset ?? 0;
        const end = limit !== undefined ? start + groups.length : totalGroups;
        return c.json({
          groups,
          pagination: {
            total: totalGroups,
            offset: start,
            limit: limit ?? totalGroups,
            hasMore: end < totalGroups,
          },
        });
      }

      // Flat 뷰 (기존 API 호환)
      const allEvents = store.listSkipEvents(repo ? { repo } : undefined);
      const total = allEvents.length;
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : total;
      const events = allEvents.slice(start, end);

      return c.json({
        events,
        pagination: {
          total,
          offset: start,
          limit: limit ?? total,
          hasMore: end < total,
        },
      });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch skip events");
    }
  });

  // 특정 그룹(issueNumber+repo+reasonCode) 전체 삭제
  api.delete("/api/skip-events/group", async (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode" }, 403);
    }
    try {
      const body = await c.req.json<{ issueNumber?: unknown; repo?: unknown; reasonCode?: unknown }>();
      const issueNumber = typeof body.issueNumber === "number" ? body.issueNumber : Number(body.issueNumber);
      const repoVal = typeof body.repo === "string" ? body.repo : "";
      const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "";
      if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repoVal || !reasonCode) {
        return c.json({ error: "issueNumber, repo, reasonCode 필수" }, 400);
      }
      const deleted = store.deleteSkipEventsByGroup(issueNumber, repoVal, reasonCode);
      return c.json({ deleted });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to delete skip event group");
    }
  });
}
