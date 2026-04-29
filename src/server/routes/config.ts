import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { JobQueue } from "../../queue/job-queue.js";
import type { ConfigWatcher } from "../../config/config-watcher.js";
import type { SSEManager } from "../sse-manager.js";
import type { AQConfig } from "../../types/config.js";
import { safeError } from "../route-context.js";
import { loadConfig, updateConfigSection } from "../../config/loader.js";
import { maskSensitiveConfig } from "../../utils/config-masker.js";
import { getBasicFieldMetas } from "../../config/schema-meta.js";
import { getPresets } from "../../config/presets.js";
import { UpdateConfigRequestSchema } from "../../types/api.js";
import { zodValidationHook } from "../dashboard-api.js";
import { setGlobalLogLevel, getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import { sanitizeErrorMessage } from "../../utils/error-sanitizer.js";

export interface ConfigRouteContext {
  queue: JobQueue;
  sseManager: SSEManager;
  configWatcher?: ConfigWatcher;
  rootDir: string;
}

/**
 * /api/config/* 라우트 등록 (Plan C #C9 — 6단계).
 *
 * 이전: dashboard-api.ts 524-601 (4 routes, 78줄).
 * GET /api/config는 마스킹된 설정을 반환하고, PUT은 업데이트 후 런타임 적용 +
 * SSE 브로드캐스트까지 수행한다.
 */
export function registerConfigRoutes(api: Hono, ctx: ConfigRouteContext): void {
  const { queue, sseManager, configWatcher, rootDir } = ctx;

  // Get configuration (masked for security)
  api.get("/api/config", (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const maskedConfig = maskSensitiveConfig(config);
      return c.json({ config: maskedConfig });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to load configuration");
    }
  });

  // Get Basic tab field metadata (type, default, min/max, options)
  api.get("/api/config/schema-meta", (c) => {
    return c.json({ fields: getBasicFieldMetas() });
  });

  // Get config presets list
  api.get("/api/config/presets", (c) => {
    return c.json({ presets: getPresets() });
  });

  // Update configuration
  api.put(
    "/api/config",
    zValidator("json", UpdateConfigRequestSchema.passthrough(), zodValidationHook),
    async (c) => {
      try {
        const body = c.req.valid("json");

        // Filter out undefined values and complex sections (projects).
        // hooks는 passthrough 스키마로 통과되어 config에 저장된다.
        const { projects: _projects, ...safeData } = body as Record<string, unknown>;
        const cleanedData = Object.fromEntries(
          Object.entries(safeData)
            .map(([key, value]) => [
              key,
              typeof value === "object" && value !== null
                ? Object.fromEntries(
                    Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
                  )
                : value,
            ])
            .filter(([, v]) => v !== undefined)
        ) as Partial<AQConfig>;

        updateConfigSection(rootDir, cleanedData);
        configWatcher?.refresh();

        if (configWatcher) {
          try {
            const newConfig = configWatcher.current();

            if (body.general?.concurrency !== undefined) {
              queue.setConcurrency(newConfig.general.concurrency);
            }
            if (body.general?.logLevel !== undefined) {
              setGlobalLogLevel(newConfig.general.logLevel);
            }

            sseManager.broadcast("configChanged", {
              changes: body,
              timestamp: new Date().toISOString(),
            });
          } catch (runtimeError: unknown) {
            // 런타임 적용 실패는 요청 자체를 실패로 만들지 않는다 — 경고만 남기고 응답은 success.
            getLogger().warn(`Failed to apply runtime config changes: ${getErrorMessage(runtimeError)}`);
          }
        }

        return c.json({ success: true, message: "Configuration updated successfully" });
      } catch (error: unknown) {
        const rawMessage = getErrorMessage(error);
        const isValidationError =
          rawMessage.includes("validation") ||
          rawMessage.includes("Invalid") ||
          rawMessage.includes("not found");
        const status = isValidationError ? 400 : 500;
        const prefix = isValidationError ? "Configuration validation failed" : "Failed to update configuration";
        return c.json({ error: `${prefix}: ${sanitizeErrorMessage(rawMessage)}` }, status);
      }
    }
  );
}
