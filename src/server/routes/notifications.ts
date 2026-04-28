import type { Hono } from "hono";
import type { JobStore } from "../../queue/job-store.js";
import type { SSEManager } from "../sse-manager.js";
import { safeError } from "../route-context.js";
import { GetNotificationsQuerySchema, formatZodError } from "../../types/api.js";

export interface NotificationsRouteContext {
  store: JobStore;
  sseManager: SSEManager;
  readOnly: boolean;
}

/**
 * /api/notifications/* 라우트 등록 (Plan C #C9 — 1단계).
 *
 * 이전: dashboard-api.ts 1973-2117 (145줄, 7 routes).
 * 이후: 본 파일이 단일 책임으로 캡슐화. dashboard-api.ts의 createDashboardRoutes는
 *      `registerNotificationsRoutes(api, { store, sseManager, readOnly })`만 호출.
 */
export function registerNotificationsRoutes(api: Hono, ctx: NotificationsRouteContext): void {
  const { store, sseManager, readOnly } = ctx;

  api.get("/api/notifications/unread-count", (c) => {
    try {
      const unreadCount = store.getAqDb().countUnreadNotifications();
      return c.json({ unreadCount });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch unread count");
    }
  });

  api.get("/api/notifications", (c) => {
    try {
      const queryParams = {
        isRead: c.req.query("isRead"),
        type: c.req.query("type"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
      };

      const parseResult = GetNotificationsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const { isRead, type: typeFilter, limit, offset } = parseResult.data;
      const aqDb = store.getAqDb();
      const isReadFilter = isRead === "true" ? true : isRead === "false" ? false : undefined;
      const notifFilter: { isRead?: boolean; type?: string } = {};
      if (isReadFilter !== undefined) notifFilter.isRead = isReadFilter;
      if (typeFilter !== undefined) notifFilter.type = typeFilter;
      const notifications = aqDb.listNotifications({ ...notifFilter, limit, offset });
      const total = aqDb.countNotifications(notifFilter);
      const unreadCount = aqDb.countUnreadNotifications();
      const start = offset ?? 0;

      return c.json({
        notifications,
        total,
        unreadCount,
        pagination: {
          total,
          offset: start,
          limit: limit ?? total,
          hasMore: start + notifications.length < total,
        },
      });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch notifications");
    }
  });

  // mark all as read (static route before :id/read)
  api.post("/api/notifications/read-all", (c) => {
    try {
      const count = store.getAqDb().markAllNotificationsRead();
      sseManager.broadcast("notificationsReadAll", { count, timestamp: Date.now() });
      return c.json({ status: "ok", count });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to mark all notifications as read");
    }
  });

  api.post("/api/notifications/:id/read", (c) => {
    try {
      const idParam = c.req.param("id");
      const id = parseInt(idParam, 10);
      if (isNaN(id) || id <= 0) {
        return c.json({ error: "Invalid notification id" }, 400);
      }
      const updated = store.getAqDb().markNotificationRead(id);
      if (!updated) {
        return c.json({ error: "Notification not found" }, 404);
      }
      return c.json({ status: "ok", id });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to mark notification as read");
    }
  });

  // prune read notifications older than maxAgeDays (default 14)
  api.post("/api/notifications/prune", async (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode" }, 403);
    }
    try {
      let maxAgeDays = 14;
      try {
        const body = await c.req.json<{ maxAgeDays?: unknown }>();
        if (typeof body?.maxAgeDays === "number" && body.maxAgeDays > 0) {
          maxAgeDays = Math.floor(body.maxAgeDays);
        }
      } catch {
        // body 없음 → 기본값 14일
      }
      const deleted = store.pruneReadNotifications(maxAgeDays);
      sseManager.broadcast("notificationsPruned", { deleted, maxAgeDays, timestamp: Date.now() });
      return c.json({ deleted, maxAgeDays });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to prune notifications");
    }
  });

  // delete all (옵션으로 isRead 필터)
  api.delete("/api/notifications", (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode" }, 403);
    }
    try {
      const isReadParam = c.req.query("isRead");
      const filter: { isRead?: boolean } = {};
      if (isReadParam === "true") filter.isRead = true;
      else if (isReadParam === "false") filter.isRead = false;
      const deleted = store.deleteAllNotifications(filter);
      sseManager.broadcast("notificationsDeleted", { deleted, timestamp: Date.now() });
      return c.json({ deleted });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to delete notifications");
    }
  });

  api.delete("/api/notifications/:id", (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode" }, 403);
    }
    try {
      const idParam = c.req.param("id");
      const id = parseInt(idParam, 10);
      if (isNaN(id) || id <= 0) {
        return c.json({ error: "Invalid notification id" }, 400);
      }
      const deleted = store.deleteNotification(id);
      if (!deleted) {
        return c.json({ error: "Notification not found" }, 404);
      }
      return c.json({ status: "ok", id });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to delete notification");
    }
  });
}
