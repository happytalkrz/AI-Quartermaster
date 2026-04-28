import type { Hono } from "hono";
import { basename } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import type { JobStore } from "../../queue/job-store.js";
import type { JobQueue } from "../../queue/job-queue.js";
import type { ConfigWatcher } from "../../config/config-watcher.js";
import type { SSEManager } from "../sse-manager.js";
import type { QuotaStatus } from "../../types/config.js";
import { safeError } from "../route-context.js";
import { loadConfig } from "../../config/loader.js";
import { SelfUpdater } from "../../update/self-updater.js";
import { checkClaudeQuota } from "../../claude/quota-checker.js";
import { runCli } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import { sanitizeErrorMessage } from "../../utils/error-sanitizer.js";

/**
 * AQM 설치 루트의 package.json에서 버전을 읽는다.
 * import.meta.url 기준으로 — process.cwd()는 서버 실행 디렉토리일 뿐 설치 루트와
 * 다를 수 있어 "ENOENT: package.json" 에러를 일으킬 수 있다.
 *
 * src/server/routes/version.ts (dev) → ../../../package.json
 * dist/server/routes/version.js (build) → ../../../package.json (동일)
 */
function getCurrentVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson.version;
}

export interface VersionRouteContext {
  store: JobStore;
  queue: JobQueue;
  sseManager: SSEManager;
  configWatcher?: ConfigWatcher;
  rootDir: string;
  getQuotaStatus: () => QuotaStatus | null;
  setQuotaStatus: (status: QuotaStatus) => void;
}

/**
 * /api/version, /api/claude-profile*, /api/update 라우트 등록 (Plan C #C9 — 2단계).
 *
 * 이전: dashboard-api.ts 1346-1460 (4 routes, 115줄).
 */
export function registerVersionRoutes(api: Hono, ctx: VersionRouteContext): void {
  const { store, queue, sseManager, configWatcher, rootDir, getQuotaStatus, setQuotaStatus } = ctx;

  api.get("/api/version", async (c) => {
    try {
      const currentVersion = getCurrentVersion();
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const selfUpdater = new SelfUpdater(config.git, { cwd: rootDir });

      try {
        const updateInfo = await selfUpdater.checkForUpdates();
        return c.json({
          currentVersion,
          currentHash: updateInfo.currentHash.substring(0, 8),
          remoteHash: updateInfo.remoteHash.substring(0, 8),
          hasUpdates: updateInfo.hasUpdates,
          packageLockChanged: updateInfo.packageLockChanged,
        });
      } catch (updateError: unknown) {
        getLogger().warn(`업데이트 확인 실패: ${getErrorMessage(updateError)}`);
        return c.json({
          currentVersion,
          currentHash: "unknown",
          remoteHash: "unknown",
          hasUpdates: false,
          packageLockChanged: false,
          error: "업데이트 확인에 실패했습니다",
        });
      }
    } catch (error: unknown) {
      return safeError(c, error, "버전 정보 조회 실패");
    }
  });

  api.get("/api/claude-profile", async (c) => {
    const configDir = process.env.CLAUDE_CONFIG_DIR || "";
    const profile = configDir ? basename(configDir).replace(/^\.claude-?/, "") || "default" : "default";
    const config = configWatcher?.current() ?? loadConfig(rootDir);
    const models = config.commands.claudeCli.models;

    let cliVersion = "unknown";
    try {
      const result = await runCli(config.commands.claudeCli.path, ["--version"], { timeout: 5000 });
      if (result.exitCode === 0) cliVersion = result.stdout.trim();
    } catch { /* 비차단 버전 조회 — 실패 무시 */ }

    return c.json({
      profile,
      configDir,
      cliVersion,
      model: config.commands.claudeCli.model,
      models: {
        plan: models?.plan,
        phase: models?.phase,
        review: models?.review,
        fallback: models?.fallback,
      },
      maxTurns: config.commands.claudeCli.maxTurns,
      timeout: config.commands.claudeCli.timeout,
      quotaStatus: getQuotaStatus(),
    });
  });

  api.post("/api/claude-profile/refresh", async (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const status = await checkClaudeQuota(config.commands.claudeCli);
      setQuotaStatus(status);
      return c.json({ quotaStatus: status });
    } catch (error: unknown) {
      return safeError(c, error, "quota 재검사 실패");
    }
  });

  api.post("/api/update", async (c) => {
    try {
      const activeJobs = store.list().filter(job => job.status === "running" || job.status === "queued");
      if (activeJobs.length > 0) {
        getLogger().info(`업데이트 전 진행 중인 잡 ${activeJobs.length}개 취소 중`);
        for (const job of activeJobs) {
          queue.cancel(job.id);
          getLogger().info(`잡 취소: ${job.id} (이슈 #${job.issueNumber}, 상태: ${job.status})`);
        }
      }

      const config = loadConfig(rootDir);
      const selfUpdater = new SelfUpdater(config.git, { cwd: rootDir });
      getLogger().info("사용자 요청으로 업데이트 시작");

      const result = await selfUpdater.performSelfUpdate();
      if (result.updated) {
        sseManager.broadcast("updateCompleted", {
          updated: result.updated,
          needsRestart: result.needsRestart,
          timestamp: new Date().toISOString(),
        });
      }

      return c.json({
        message: result.updated ? "업데이트가 완료되었습니다" : "이미 최신 버전입니다",
        updated: result.updated,
        needsRestart: result.needsRestart,
      });
    } catch (error: unknown) {
      const rawMessage = getErrorMessage(error);
      getLogger().error(`업데이트 실패: ${rawMessage}`);
      const message = sanitizeErrorMessage(rawMessage);
      sseManager.broadcast("updateFailed", {
        error: message,
        timestamp: new Date().toISOString(),
      });
      return c.json({ error: `업데이트 실패: ${message}` }, 500);
    }
  });
}
