import { resolve } from "path";
import { existsSync, readFileSync, readdirSync, realpathSync } from "fs";
import { assembleHtml } from "./server/html-assembler.js";
import { fileURLToPath } from "url";
import { loadConfig, tryLoadConfig } from "./config/loader.js";
import { runSetup, setupWebhook } from "./setup/setup-wizard.js";
import { runInitCommand, parseInitOptions, printInitHelp } from "./setup/init-command.js";
import { runPipeline } from "./pipeline/core/orchestrator.js";
import { getLogger, setGlobalLogLevel } from "./utils/logger.js";
import { detectWSL } from "./utils/detect-wsl.js";
import { runCli } from "./utils/cli-runner.js";
import { getErrorMessage } from "./utils/error-utils.js";
import { JobStore } from "./queue/job-store.js";
import { JobQueue } from "./queue/job-queue.js";
import { createWebhookApp, startServer } from "./server/webhook-server.js";
import { createDashboardRoutes, cleanupDashboardResources } from "./server/dashboard-api.js";
import { createHealthRoutes } from "./server/health.js";
import { writePidFile, cleanupStalePid, removePidFile, readPidFile } from "./server/pid-manager.js";
import { notifySuccess, notifyFailure } from "./notification/notifier.js";
import { cleanOldWorktrees } from "./git/worktree-cleaner.js";
import { runDoctor } from "./setup/doctor.js";
import { JobLogger } from "./queue/job-logger.js";
import { IssuePoller } from "./polling/issue-poller.js";
import { PatternStore } from "./learning/pattern-store.js";
import { SelfUpdater } from "./update/self-updater.js";
import { ConfigWatcher } from "./config/config-watcher.js";
import { AutomationScheduler } from "./automation/scheduler.js";
import { initDispatcher } from "./pipeline/automation/automation-dispatcher.js";
import type { RuleEngineHandlers, AutomationRule } from "./types/automation.js";

export function buildProjectConcurrency(projects: Array<{ repo: string; concurrency?: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const p of projects) {
    if (p.concurrency !== undefined) {
      result[p.repo] = p.concurrency;
    }
  }
  return result;
}

interface CliArgs {
  command?: string;
  issue?: number;
  repo?: string;
  config?: string;
  target?: string;
  dryRun?: boolean;
  port?: number;
  host?: string;
  mode?: string;
  interval?: number;
  execute?: boolean;
  job?: string;
  nonInteractive?: boolean;
  configOverrides?: Record<string, unknown>;
}

export async function runCommand(args: CliArgs): Promise<void> {
  if (!args.issue || !args.repo) {
    console.error("Usage: aqm run --issue <number> --repo <owner/repo>");
    process.exit(1);
  }

  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  const effectiveConfig = args.dryRun
    ? { ...config, general: { ...config.general, dryRun: true } }
    : config;
  setGlobalLogLevel(effectiveConfig.general.logLevel);
  const targetRoot = args.target ? resolve(args.target) : process.cwd();
  const logger = getLogger();

  logger.info(`AI Quartermaster 시작 - Issue #${args.issue} (${args.repo})`);
  logger.info(`대상 프로젝트: ${targetRoot}`);

  const result = await runPipeline({
    issueNumber: args.issue,
    repo: args.repo,
    config: effectiveConfig,
    projectRoot: targetRoot,
    aqRoot,
  });

  process.exit(result.success ? 0 : 1);
}

export async function checkForUpdates(aqRoot: string): Promise<void> {
  try {
    const { runCli } = await import("./utils/cli-runner.js");
    await runCli("git", ["fetch", "--quiet"], { cwd: aqRoot, timeout: 10000 });
    const result = await runCli("git", ["rev-list", "HEAD..origin/main", "--count"], { cwd: aqRoot, timeout: 5000 });
    const behind = parseInt(result.stdout.trim(), 10);
    if (behind > 0) {
      console.log(`\n  📦 업데이트 ${behind}개 사용 가능 — aqm update 로 업데이트하세요\n`);
    }
  } catch {
    // 네트워크 실패 등 무시
  }
}

export async function startCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();

  // Check for updates (non-blocking)
  checkForUpdates(aqRoot).catch(() => {});

  // Load .env
  const envPath = resolve(aqRoot, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }

  const config = loadConfig(aqRoot);
  const effectiveConfig = args.dryRun
    ? { ...config, general: { ...config.general, dryRun: true } }
    : config;
  setGlobalLogLevel(effectiveConfig.general.logLevel);
  const logger = getLogger();
  const port = args.port ?? 3000;
  const isWSL = detectWSL();
  const host = args.host ?? (isWSL ? "0.0.0.0" : "127.0.0.1");

  // === Pre-flight checks ===
  const projects = effectiveConfig.projects ?? [];
  if (projects.length === 0) {
    console.error("\n✗ config.yml에 projects가 등록되어 있지 않습니다.");
    console.error("  config.yml을 열고 projects 섹션에 대상 프로젝트를 추가하세요:\n");
    console.error("  projects:");
    console.error('    - repo: "owner/repo-name"');
    console.error('      path: "/path/to/local/clone"');
    console.error('      baseBranch: "main"\n');
    process.exit(1);
  }

  let hasError = false;
  for (const p of projects) {
    if (!p.repo || p.repo === "owner/repo-name") {
      console.error(`\n✗ 프로젝트 repo가 기본값입니다. 실제 저장소로 변경하세요.`);
      hasError = true;
    }
    if (!p.path || p.path === "/path/to/local/clone") {
      console.error(`✗ 프로젝트 "${p.repo}" path가 기본값입니다. 실제 경로로 변경하세요.`);
      hasError = true;
    } else if (!existsSync(p.path)) {
      console.error(`✗ 프로젝트 "${p.repo}" 경로가 존재하지 않습니다: ${p.path}`);
      hasError = true;
    }
  }
  if (hasError) {
    console.error("\nconfig.yml을 수정한 후 다시 시작하세요.\n");
    process.exit(1);
  }

  // CLI --mode 인자가 config보다 우선
  const effectiveMode = (args.mode as "webhook" | "polling" | "hybrid" | undefined) ?? effectiveConfig.general.serverMode;

  // Override pollingIntervalMs from --interval CLI arg (seconds → ms)
  if (args.interval !== undefined) {
    const intervalMs = args.interval * 1000;
    if (intervalMs < 10000) {
      console.error("--interval은 최소 10초 이상이어야 합니다.");
      process.exit(1);
    }
    effectiveConfig.general.pollingIntervalMs = intervalMs;
  }

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (effectiveMode !== "polling" && !webhookSecret) {
    console.error("\n✗ GITHUB_WEBHOOK_SECRET이 설정되지 않았습니다.");
    console.error("  먼저 aqm setup을 실행하세요.\n");
    process.exit(1);
  }

  // === Cache dashboard HTML and JS at startup (fix #15) ===
  const publicDir = resolve(aqRoot, "src/server/public");
  let dashboardHtml: string;
  try { dashboardHtml = assembleHtml(publicDir); } catch { dashboardHtml = ""; }

  // Cache dashboard JS files at startup
  const jsDir = resolve(aqRoot, "src/server/public/js");
  const dashboardJs: Record<string, string> = {};
  try {
    for (const f of readdirSync(jsDir)) {
      if (f.endsWith(".js")) {
        dashboardJs[f] = readFileSync(resolve(jsDir, f), "utf-8");
      }
    }
  } catch { /* js dir may not exist */ }

  logger.info(`운영 모드: ${effectiveMode}`);

  if (effectiveMode !== "polling") {
    // === Auto-register webhooks for projects in parallel (fix #16) ===
    const smeeUrl = process.env.SMEE_URL;
    if (smeeUrl) {
      await Promise.allSettled(
        projects.map(p => setupWebhook(aqRoot, p.repo).catch((err: unknown) =>
          logger.warn(`Webhook 등록 실패 (${p.repo}): ${getErrorMessage(err)}`)
        ))
      );
    }

    logger.info(`프로젝트 ${projects.length}개 등록됨: ${projects.map(p => p.repo).join(", ")}`);

    // Auto-start smee-client if SMEE_URL is set
    if (smeeUrl) {
      const { spawn: spawnChild } = await import("child_process");
      const smee = spawnChild("npx", ["smee-client", "--url", smeeUrl, "--target", `http://localhost:${port}/webhook/github`], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        shell: true,
      });
      smee.stdout?.on("data", (d: Buffer) => logger.info(`[smee] ${d.toString().trim()}`));
      smee.stderr?.on("data", (d: Buffer) => logger.warn(`[smee] ${d.toString().trim()}`));
      smee.on("error", (err) => logger.warn(`smee-client 시작 실패: ${err.message}`));
      process.on("exit", () => { try { smee.kill(); } catch { /* ignore */ } });
      logger.info(`Smee 프록시 연결: ${smeeUrl}`);
    } else {
      logger.warn("SMEE_URL 미설정 — webhook을 받으려면 .env에 SMEE_URL을 설정하세요");
    }
  } else {
    logger.info(`프로젝트 ${projects.length}개 등록됨: ${projects.map(p => p.repo).join(", ")} [polling 전용 모드]`);
  }

  const dataDir = resolve(aqRoot, "data");
  const store = new JobStore(dataDir);
  const projectConcurrency = buildProjectConcurrency(effectiveConfig.projects ?? []);
  const queue = new JobQueue(store, effectiveConfig.general.concurrency, async (job) => {
    const jl = new JobLogger(store, job.id);
    try {
      // Check for checkpoint to resume from
      const { loadCheckpoint } = await import("./pipeline/errors/checkpoint.js");
      const checkpoint = loadCheckpoint(resolve(aqRoot, "data"), job.issueNumber);
      if (checkpoint) {
        jl.log(`체크포인트 발견 — ${checkpoint.state} 단계부터 재개`);
      }

      const result = await runPipeline({
        issueNumber: job.issueNumber,
        repo: job.repo,
        config: effectiveConfig,
        aqRoot,
        jobLogger: jl,
        resumeFrom: checkpoint ?? undefined,
        isRetry: job.isRetry,
      });

      const ghPath = effectiveConfig.commands.ghCli.path;
      const dryRun = effectiveConfig.general.dryRun;

      if (result.success && result.prUrl) {
        await notifySuccess(job.repo, job.issueNumber, result.prUrl, { ghPath, dryRun });
        return { prUrl: result.prUrl };
      } else {
        const errorMsg = result.error ?? "Pipeline failed without error details";
        await notifyFailure(job.repo, job.issueNumber, errorMsg, {
          ghPath, dryRun,
          errorCategory: result.report?.errorCategory,
          lastOutput: result.report?.errorSummary,
        });
        return { error: errorMsg, diagnosis: result.report?.diagnosis };
      }
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err);
      await notifyFailure(job.repo, job.issueNumber, errorMsg, {
        ghPath: effectiveConfig.commands.ghCli.path,
        dryRun: effectiveConfig.general.dryRun,
      });
      return { error: errorMsg };
    }
  }, effectiveConfig.general.stuckTimeoutMs, Object.keys(projectConcurrency).length > 0 ? projectConcurrency : undefined, undefined, effectiveConfig.general.stuckThresholds);

  // Recover jobs from previous session
  queue.recover();

  // Prune old completed/failed jobs to prevent unbounded accumulation
  store.prune(effectiveConfig.general.maxJobs);

  // === Setup ConfigWatcher for hot reload ===
  const { applyConfigChanges } = await import("./server/dashboard-api.js");
  const configWatcher = new ConfigWatcher(aqRoot);
  configWatcher.on('configChanged', async () => {
    try {
      logger.info('Config 변경 감지 - hot reload 시작...');

      // Reload configuration
      const newConfig = loadConfig(aqRoot);
      const newEffectiveConfig = args.dryRun
        ? { ...newConfig, general: { ...newConfig.general, dryRun: true } }
        : newConfig;

      applyConfigChanges(effectiveConfig, newEffectiveConfig, queue, scheduler);

      // Update effectiveConfig reference for future use
      effectiveConfig.general = newEffectiveConfig.general;
      effectiveConfig.projects = newEffectiveConfig.projects;
      effectiveConfig.automations = newEffectiveConfig.automations;

      logger.info('Config hot reload 완료');
    } catch (err: unknown) {
      logger.error(`Config hot reload 실패: ${getErrorMessage(err)}`);
    }
  });

  configWatcher.startWatching();
  logger.info('ConfigWatcher 시작됨 - config.yml 변경을 감지합니다');

  // === Graceful restart callback ===
  const performGracefulRestart = async (): Promise<void> => {
    logger.info("업데이트 감지됨 — graceful restart 시작...");

    try {
      // Stop poller to prevent new issues from being picked up
      poller?.stop();
      scheduler?.stop();

      // Wait for running jobs to complete
      logger.info("실행 중인 job 완료 대기...");
      await queue.shutdown(300000); // 5분 타임아웃

      // Apply updates
      const selfUpdater = new SelfUpdater(effectiveConfig.git, { cwd: aqRoot });
      const updateResult = await selfUpdater.performSelfUpdate();

      if (updateResult.updated && updateResult.needsRestart) {
        logger.info("업데이트 완료 — 프로세스 재시작 중...");

        // Restart with same arguments
        const { spawn } = await import("child_process");
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          stdio: "inherit",
        });

        child.unref();
        process.exit(0);
      }
    } catch (err: unknown) {
      logger.error(`graceful restart 실패: ${getErrorMessage(err)}`);
      // Continue running without restart
      if (poller && !poller.isRunning()) {
        poller.start();
      }
    }
  };

  // === Automation rule scheduler ===
  const automationHandlers: RuleEngineHandlers = {
    addLabel: async (repo: string, issueNumber: number, labels: string[]) => {
      logger.info(`[AutomationScheduler] 라벨 추가: ${repo}#${issueNumber} <- ${labels.join(', ')}`);
      const ghPath = effectiveConfig.commands.ghCli.path;
      const result = await runCli(
        ghPath,
        ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", labels.join(",")],
        {}
      );
      if (result.exitCode !== 0) {
        logger.error(`[AutomationScheduler] 라벨 추가 실패: ${result.stderr}`);
      }
    },
    startJob: async (repo: string, issueNumber: number) => {
      logger.info(`[AutomationScheduler] 잡 시작: ${repo}#${issueNumber}`);
      queue.enqueue(issueNumber, repo, []);
    },
    pauseProject: async (repo: string, reason?: string) => {
      logger.warn(`[AutomationScheduler] pauseProject 액션은 현재 미지원입니다 — 구현 예정: ${repo}${reason ? ` (${reason})` : ''}`);
    }
  };

  const automationRules: AutomationRule[] = effectiveConfig.automations ?? [];
  const scheduler = new AutomationScheduler(effectiveConfig, automationRules, automationHandlers);

  // === Poller: polling/hybrid 모드에서만 시작, webhook 모드에서는 비활성 ===
  const poller = effectiveMode !== "webhook"
    ? new IssuePoller(effectiveConfig, store, queue, performGracefulRestart)
    : null;
  poller?.start();

  // Mount dashboard and health routes
  const apiKey = process.env.DASHBOARD_API_KEY || undefined;

  // === Non-local bind 보안 검사 ===
  const isLocalBind = host === "127.0.0.1" || host === "localhost";
  const insecureAllowed = process.env.DASHBOARD_ALLOW_INSECURE === "true";
  if (!isLocalBind && !apiKey && !insecureAllowed && !isWSL) {
    console.error(`\n✗ 보안 오류: non-local bind(${host})에서 DASHBOARD_API_KEY가 설정되지 않았습니다.`);
    console.error("  API가 인증 없이 외부 네트워크에 노출됩니다. 아래 중 하나를 선택하세요:\n");
    console.error("  1. DASHBOARD_API_KEY 환경변수 설정 (권장):");
    console.error("       export DASHBOARD_API_KEY=<strong-random-key>");
    console.error("  2. localhost로 변경 (기본값):");
    console.error("       aqm start --host 127.0.0.1");
    console.error("  3. 보안 위험을 감수하고 강제 실행 (비권장):");
    console.error("       export DASHBOARD_ALLOW_INSECURE=true\n");
    process.exit(1);
  }
  const wslReadOnly = !isLocalBind && !apiKey && (isWSL || insecureAllowed);
  if (!isLocalBind && !apiKey && isWSL) {
    logger.warn(
      `WSL 환경 감지: 대시보드를 ${host}:${port}에 read-only 모드로 바인딩합니다. ` +
      `쓰기 작업(config 수정, 잡 취소 등)은 차단됩니다. ` +
      `full access가 필요하면 DASHBOARD_API_KEY를 설정하세요.`
    );
  }
  if (!isLocalBind && !apiKey && insecureAllowed) {
    console.error('⚠ insecure 모드 허용 — dashboard가 read-only로 강제됩니다');
  }

  const patternStore = new PatternStore(dataDir);
  const dashboardRoutes = createDashboardRoutes(store, queue, configWatcher, apiKey, host, effectiveConfig.general.dashboardAuth, wslReadOnly, patternStore);
  const healthRoutes = createHealthRoutes(queue);

  let app: ReturnType<typeof createWebhookApp>;
  if (effectiveMode === "polling") {
    // polling 모드: webhook 라우트 미마운트 — 미인증 webhook 페이로드 수신 방지
    const { Hono } = await import("hono");
    const pollingApp = new Hono();
    pollingApp.route("/", dashboardRoutes);
    pollingApp.route("/", healthRoutes);
    app = pollingApp as ReturnType<typeof createWebhookApp>;
  } else {
    // webhook/hybrid 모드: webhook 라우트 마운트
    app = createWebhookApp({
      config: effectiveConfig,
      webhookSecret,
      store,
      onPipelineTrigger: (issueNumber, repo, dependencies, triggerReason) => {
        queue.enqueue(issueNumber, repo, dependencies, undefined, undefined, undefined, triggerReason);
      },
    });
    app.route("/", dashboardRoutes);
    app.route("/", healthRoutes);
  }

  // Serve cached dashboard HTML at GET /
  app.get("/", (c) => {
    if (!dashboardHtml) return c.text("Dashboard UI not found", 404);
    return c.html(dashboardHtml);
  });

  // Serve cached dashboard JS files
  app.get("/js/:file", (c) => {
    const file = c.req.param("file");
    const content = dashboardJs[file];
    if (!content) return c.text("Not found", 404);
    return c.text(content, 200, { "Content-Type": "application/javascript; charset=utf-8" });
  });

  // === PID file management ===
  const pidPath = resolve(aqRoot, "data/aqm.pid");
  const canStart = cleanupStalePid(pidPath);
  if (!canStart) {
    const existingPid = readPidFile(pidPath);
    console.error(`\nAQM이 이미 실행 중입니다 (PID: ${existingPid})\n`);
    process.exit(1);
  }

  startServer(app, port, host);
  initDispatcher(scheduler);
  scheduler.start();
  writePidFile(pidPath);

  const cleanup = () => removePidFile(pidPath);
  process.on("exit", cleanup);

  const gracefulShutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully, waiting for running jobs...`);
    poller?.stop();
    scheduler.stop();
    configWatcher.stopWatching();
    cleanupDashboardResources();
    await queue.shutdown(30000);
    cleanup();
    process.exit(0);
  };

  process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });
  process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });

  logger.info(`Dashboard available at http://${host}:${port}/`);
}

async function setupCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  await runSetup(aqRoot, { nonInteractive: args.nonInteractive });
}

async function initCommand(args: CliArgs, rawArgs: string[]): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();

  // Parse init-specific options from raw args
  const initOptions = parseInitOptions(rawArgs);

  if (initOptions.help) {
    printInitHelp();
    return;
  }

  // Use global dry-run if specified
  if (args.dryRun) {
    initOptions.dryRun = true;
  }

  await runInitCommand(aqRoot, initOptions);
}

export async function statusCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const dataDir = resolve(aqRoot, "data");
  const store = new JobStore(dataDir);
  const jobs = store.list();

  if (jobs.length === 0) {
    console.log("No jobs found.");
    return;
  }

  const counts: Record<string, number> = {};
  for (const job of jobs) {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }

  console.log(`\nJob Status Summary (${jobs.length} total):`);
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log("\nRecent Jobs (last 10):");
  for (const job of jobs.slice(0, 10)) {
    const duration = job.startedAt && job.completedAt
      ? `${((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000).toFixed(1)}s`
      : "-";
    console.log(`  ${job.id}  #${job.issueNumber}  ${job.repo}  [${job.status}]  ${duration}`);
    if (job.prUrl) console.log(`    PR: ${job.prUrl}`);
    if (job.error) console.log(`    Error: ${job.error}`);
  }
  console.log();
}

export async function doctorCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const result = tryLoadConfig(aqRoot);
  await runDoctor(result.config, aqRoot, result.error);
}

export async function planCommand(args: CliArgs): Promise<void> {
  if (!args.repo) {
    console.error("Usage: aqm plan --repo <owner/repo> [--execute]");
    process.exit(1);
  }

  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  setGlobalLogLevel(config.general.logLevel);

  const { listTriggerIssues, generateExecutionPlan, printExecutionPlan } = await import("./pipeline/automation/issue-orchestrator.js");

  const ghPath = config.commands.ghCli.path;
  const labels = config.safety.allowedLabels;

  console.log(`\n이슈 목록을 가져오는 중... (${args.repo}, 라벨: ${labels.join(", ")})`);
  const issues = await listTriggerIssues(args.repo, labels, ghPath);

  if (issues.length === 0) {
    console.log("트리거 라벨이 붙은 열린 이슈가 없습니다.");
    return;
  }

  console.log(`이슈 ${issues.length}개를 분석 중...`);
  const plan = await generateExecutionPlan(issues, config.commands.claudeCli, aqRoot, aqRoot);
  plan.repo = args.repo;

  printExecutionPlan(plan);

  if (args.execute) {
    const dataDir = resolve(aqRoot, "data");
    const { JobStore } = await import("./queue/job-store.js");
    const { JobQueue } = await import("./queue/job-queue.js");
    const store = new JobStore(dataDir);
    const planProjectConcurrency = buildProjectConcurrency(config.projects ?? []);
    const queue = new JobQueue(store, config.general.concurrency, async () => ({ error: "직접 실행 모드에서는 큐만 등록됩니다" }), config.general.stuckTimeoutMs, Object.keys(planProjectConcurrency).length > 0 ? planProjectConcurrency : undefined);

    let enqueued = 0;
    for (const batch of plan.executionOrder) {
      for (const issuePlan of batch) {
        queue.enqueue(issuePlan.issueNumber, args.repo!, issuePlan.dependencies);
        enqueued++;
      }
    }
    console.log(`\n${enqueued}개 이슈가 큐에 등록되었습니다. aqm start 로 처리하세요.`);
  }
}

export async function statsCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const dataDir = resolve(aqRoot, "data");
  const patternStore = new PatternStore(dataDir);
  const jobStore = new JobStore(dataDir);

  const stats = patternStore.getStats(args.repo);
  const successRate = stats.total > 0 ? ((stats.successes / stats.total) * 100).toFixed(1) : "N/A";

  console.log(`\nPattern Learning Stats${args.repo ? ` (${args.repo})` : ""}:`);
  console.log(`  Total runs   : ${stats.total}`);
  console.log(`  Successes    : ${stats.successes}`);
  console.log(`  Failures     : ${stats.failures}`);
  console.log(`  Success rate : ${successRate}%`);

  if (Object.keys(stats.byCategory).length > 0) {
    console.log("\nTop Failure Categories:");
    const sorted = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      console.log(`  ${cat.padEnd(20)} ${count}`);
    }
  }

  const recentFailures = patternStore.list({ type: "failure", repo: args.repo, limit: 5 });
  if (recentFailures.length > 0) {
    console.log("\nRecent Failures:");
    for (const e of recentFailures) {
      const ts = new Date(e.timestamp).toLocaleString();
      const msg = e.errorMessage ? ` — ${e.errorMessage}` : "";
      console.log(`  [${ts}] #${e.issueNumber} ${e.repo} (${e.errorCategory ?? "UNKNOWN"})${msg}`);
      if (e.phaseName) console.log(`    Phase: ${e.phaseName}`);
    }
  }

  // Cost Statistics 섹션 추가
  const costStats = jobStore.getCostStats(args.repo);
  console.log(`\nCost Statistics${args.repo ? ` (${args.repo})` : ""}:`);
  console.log(`  Total cost   : $${costStats.totalCostUsd.toFixed(2)}`);
  console.log(`  Average cost : $${costStats.avgCostUsd.toFixed(2)}`);
  console.log(`  Job count    : ${costStats.jobCount}`);

  if (costStats.topExpensiveJobs.length > 0) {
    console.log("\nTop Expensive Jobs:");
    for (const job of costStats.topExpensiveJobs) {
      console.log(`  #${String(job.issueNumber).padEnd(5)} ${job.repo.padEnd(20)} $${job.totalCostUsd.toFixed(2)}`);
    }
  }

  console.log();
}

export async function resumeCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const dataDir = resolve(aqRoot, "data");

  let issueNumber: number | undefined;
  let repo: string | undefined;

  if (args.job) {
    // --job <id>: look up the job to get issue + repo
    const { JobStore } = await import("./queue/job-store.js");
    const store = new JobStore(dataDir);
    const job = store.get(args.job);
    if (!job) {
      console.error(`No job found with id: ${args.job}`);
      process.exit(1);
    }
    issueNumber = job.issueNumber;
    repo = job.repo;
  } else if (args.issue && args.repo) {
    issueNumber = args.issue;
    repo = args.repo;
  } else {
    console.error("Usage: aqm resume --job <id>");
    console.error("       aqm resume --issue <number> --repo <owner/repo>");
    process.exit(1);
  }

  const { loadCheckpoint } = await import("./pipeline/errors/checkpoint.js");
  const checkpoint = loadCheckpoint(dataDir, issueNumber);
  if (!checkpoint) {
    console.error(`No checkpoint found for issue #${issueNumber}`);
    process.exit(1);
  }

  console.log(`Resuming pipeline for issue #${issueNumber} from state: ${checkpoint.state}`);

  const config = loadConfig(aqRoot);
  const effectiveConfig = args.dryRun
    ? { ...config, general: { ...config.general, dryRun: true } }
    : config;
  setGlobalLogLevel(effectiveConfig.general.logLevel);
  getLogger();

  const result = await runPipeline({
    issueNumber,
    repo,
    config: effectiveConfig,
    aqRoot,
    resumeFrom: checkpoint,
  });

  process.exit(result.success ? 0 : 1);
}

export async function cleanupCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  const logger = getLogger();

  logger.info("Starting worktree cleanup...");
  const removed = await cleanOldWorktrees(config.git, config.worktree, { cwd: aqRoot });
  logger.info(`Cleanup complete. Removed ${removed.length} worktree(s).`);
}

export async function versionCommand(): Promise<void> {
  try {
    // Read package.json from the AQM installation root
    const packagePath = resolve(process.cwd(), "package.json");
    const packageContent = readFileSync(packagePath, "utf-8");
    const packageData = JSON.parse(packageContent);

    console.log(`AI Quartermaster v${packageData.version}`);
  } catch (error: unknown) {
    console.error("버전 정보를 읽을 수 없습니다.");
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.command || "run";

  if (command === "run") {
    await runCommand(args);
  } else if (command === "start") {
    await startCommand(args);
  } else if (command === "setup") {
    await setupCommand(args);
  } else if (command === "init") {
    await initCommand(args, process.argv.slice(2));
  } else if (command === "setup-webhook") {
    if (!args.repo) {
      console.error("Usage: aqm setup-webhook --repo <owner/repo>");
      process.exit(1);
    }
    const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
    await setupWebhook(aqRoot, args.repo);
  } else if (command === "status") {
    await statusCommand(args);
  } else if (command === "cleanup") {
    await cleanupCommand(args);
  } else if (command === "doctor") {
    await doctorCommand(args);
  } else if (command === "plan") {
    await planCommand(args);
  } else if (command === "stats") {
    await statsCommand(args);
  } else if (command === "resume") {
    await resumeCommand(args);
  } else if (command === "version") {
    await versionCommand();
  } else if (command === "help") {
    printHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

export function printHelp(): void {
  console.log(`
AI Quartermaster

Server:
  aqm start                                       웹훅 서버 시작 (포그라운드)
  aqm start --daemon                              백그라운드 실행
  aqm start --mode polling [--interval <sec>]     폴링 모드 (webhook 불필요)
  aqm start --mode hybrid [--interval <sec>]      하이브리드 모드 (webhook + 폴링 병행)
  aqm start --port <n>                            포트 지정 (기본: 3000)
  aqm stop                                        서버 중지
  aqm restart                                     서버 재시작
  aqm logs                                        서버 로그 실시간 확인

Pipeline:
  aqm run --issue <n> --repo <owner/repo>         특정 이슈 수동 실행
  aqm resume --job <id>                           실패 파이프라인 재개
  aqm resume --issue <n> --repo <owner/repo>      이슈 번호로 재개
  aqm plan --repo <owner/repo> [--execute]        이슈 분석 및 실행 계획

Monitoring:
  aqm status                                      큐 상태
  aqm stats [--repo <owner/repo>]                 성공률/실패 통계
  aqm doctor                                      환경 점검

Management:
  aqm init [options]                              현재 프로젝트를 config.yml에 등록
  aqm setup                                       초기 설정 (인터랙티브)
  aqm setup --non-interactive                    초기 설정 (자동 생성)
  aqm setup-webhook --repo <owner/repo>           GitHub webhook 등록
  aqm cleanup                                     오래된 worktree 정리
  aqm update                                      최신 버전 업데이트
  aqm version                                     버전 확인
  aqm uninstall                                   삭제
  aqm help                                        이 도움말

Options:
  --issue <number>    이슈 번호
  --repo <owner/repo> GitHub 저장소
  --port <number>     서버 포트 (기본: 3000)
  --host <address>    바인드 주소 (기본: 127.0.0.1)
  --mode <mode>       시작 모드: webhook (기본) / polling / hybrid
  --interval <sec>    폴링 간격 (초, 기본: 60)
  --daemon, -d        백그라운드 실행
  --dry-run           외부 작업 스킵 (push, PR 생성)
  --config-override <key=value>  설정 오버라이드 (복수 지정 가능)
  --execute           plan 후 자동 실행
  --non-interactive   비인터랙티브 모드 (setup 명령용)

Environment:
  GITHUB_WEBHOOK_SECRET   웹훅 서명 검증 (webhook 모드 필수)
  SMEE_URL                Smee.io 채널 URL (webhook 프록시)
  DASHBOARD_API_KEY       대시보드 API 인증 키 (non-local bind 시 필수)
  DASHBOARD_ALLOW_INSECURE  true로 설정 시 non-local bind에서 API_KEY 없이 실행 허용 (비권장)
  AQM_HOME                설치 디렉토리 (기본: ~/.ai-quartermaster)
`);
}

export function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};

  // Check if first arg is a subcommand (doesn't start with --)
  let startIdx = 0;
  if (argv.length > 0 && !argv[0].startsWith("--")) {
    result.command = argv[0];
    startIdx = 1;
  }

  for (let i = startIdx; i < argv.length; i++) {
    if (argv[i] === "--issue" && argv[i + 1]) {
      result.issue = parseInt(argv[++i], 10);
    } else if (argv[i] === "--repo" && argv[i + 1]) {
      result.repo = argv[++i];
    } else if (argv[i] === "--config" && argv[i + 1]) {
      result.config = argv[++i];
    } else if (argv[i] === "--target" && argv[i + 1]) {
      result.target = argv[++i];
    } else if (argv[i] === "--dry-run") {
      result.dryRun = true;
    } else if (argv[i] === "--port" && argv[i + 1]) {
      result.port = parseInt(argv[++i], 10);
    } else if (argv[i] === "--host" && argv[i + 1]) {
      result.host = argv[++i];
    } else if (argv[i] === "--mode" && argv[i + 1]) {
      result.mode = argv[++i];
    } else if (argv[i] === "--interval" && argv[i + 1]) {
      result.interval = parseInt(argv[++i], 10);
    } else if (argv[i] === "--execute") {
      result.execute = true;
    } else if (argv[i] === "--job" && argv[i + 1]) {
      result.job = argv[++i];
    } else if (argv[i] === "--non-interactive") {
      result.nonInteractive = true;
    } else if (argv[i] === "--config-override" && argv[i + 1]) {
      const overrideStr = argv[++i];
      const eqIdx = overrideStr.indexOf("=");
      if (eqIdx > 0) {
        const key = overrideStr.slice(0, eqIdx);
        const value = overrideStr.slice(eqIdx + 1);
        if (!result.configOverrides) result.configOverrides = {};
        result.configOverrides[key] = value;
      }
    }
  }
  return result;
}

// Only execute main() when this file is run directly (not when imported in tests)
const __filename = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]); } catch { return process.argv[1]; } })() : "";
if (invokedPath === __filename) {
  main().catch((err: unknown) => {
    console.error("Fatal error:", getErrorMessage(err));
    process.exit(1);
  });
}
