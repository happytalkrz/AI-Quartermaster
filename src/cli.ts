import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { loadConfig } from "./config/loader.js";
import { runSetup, setupWebhook } from "./setup/setup-wizard.js";
import { runPipeline } from "./pipeline/orchestrator.js";
import { createLogger, setGlobalLogLevel } from "./utils/logger.js";
import { JobStore } from "./queue/job-store.js";
import { JobQueue } from "./queue/job-queue.js";
import { createWebhookApp, startServer } from "./server/webhook-server.js";
import { createDashboardRoutes } from "./server/dashboard-api.js";
import { createHealthRoutes } from "./server/health.js";
import { notifySuccess, notifyFailure } from "./notification/notifier.js";
import { cleanOldWorktrees } from "./git/worktree-cleaner.js";
import { JobLogger } from "./queue/job-logger.js";

interface CliArgs {
  command?: string;
  issue?: number;
  repo?: string;
  config?: string;
  target?: string;
  dryRun?: boolean;
  port?: number;
}

async function runCommand(args: CliArgs): Promise<void> {
  if (!args.issue || !args.repo) {
    console.error("Usage: npx tsx src/cli.ts run --issue <number> --repo <owner/repo> [--config <path>]");
    console.error("       npx tsx src/cli.ts --issue <number> --repo <owner/repo>");
    process.exit(1);
  }

  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  if (args.dryRun) {
    config.general.dryRun = true;
  }
  setGlobalLogLevel(config.general.logLevel);
  const targetRoot = args.target ? resolve(args.target) : process.cwd();
  const logger = createLogger(config.general.logLevel);

  logger.info(`AI 병참부 시작 - Issue #${args.issue} (${args.repo})`);
  logger.info(`대상 프로젝트: ${targetRoot}`);

  const result = await runPipeline({
    issueNumber: args.issue,
    repo: args.repo,
    config,
    projectRoot: targetRoot,
    aqRoot,
  });

  process.exit(result.success ? 0 : 1);
}

async function checkForUpdates(aqRoot: string): Promise<void> {
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

async function startCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();

  // Check for updates
  await checkForUpdates(aqRoot);

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
  if (args.dryRun) {
    config.general.dryRun = true;
  }
  setGlobalLogLevel(config.general.logLevel);
  const logger = createLogger(config.general.logLevel);
  const port = args.port ?? 3000;

  // === Pre-flight checks ===
  const projects = config.projects ?? [];
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

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) {
    console.error("\n✗ GITHUB_WEBHOOK_SECRET이 설정되지 않았습니다.");
    console.error("  먼저 aqm setup을 실행하세요.\n");
    process.exit(1);
  }

  // === Cache dashboard HTML at startup (fix #15) ===
  const htmlPath = resolve(aqRoot, "src/server/public/index.html");
  let dashboardHtml: string;
  try { dashboardHtml = readFileSync(htmlPath, "utf-8"); } catch { dashboardHtml = ""; }

  // === Auto-register webhooks for projects in parallel (fix #16) ===
  const smeeUrl = process.env.SMEE_URL;
  if (smeeUrl) {
    await Promise.allSettled(
      projects.map(p => setupWebhook(aqRoot, p.repo).catch(err =>
        logger.warn(`Webhook 등록 실패 (${p.repo}): ${err}`)
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
    process.on("exit", () => { try { smee.kill(); } catch {} });
    logger.info(`Smee 프록시 연결: ${smeeUrl}`);
  } else {
    logger.warn("SMEE_URL 미설정 — webhook을 받으려면 .env에 SMEE_URL을 설정하세요");
  }

  const dataDir = resolve(aqRoot, "data");
  const store = new JobStore(dataDir);
  const queue = new JobQueue(store, config.general.concurrency, async (job) => {
    const jl = new JobLogger(store, job.id);
    try {
      const result = await runPipeline({
        issueNumber: job.issueNumber,
        repo: job.repo,
        config,
        aqRoot,
        jobLogger: jl,
        // projectRoot is NOT passed — resolved from config.projects
      });

      const ghPath = config.commands.ghCli.path;
      const dryRun = config.general.dryRun;

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
        return { error: errorMsg };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await notifyFailure(job.repo, job.issueNumber, errorMsg, {
        ghPath: config.commands.ghCli.path,
        dryRun: config.general.dryRun,
      });
      return { error: errorMsg };
    }
  }, config.general.stuckTimeoutMs);

  // Recover jobs from previous session
  queue.recover();

  const app = createWebhookApp({
    config,
    webhookSecret,
    onPipelineTrigger: (issueNumber, repo) => {
      queue.enqueue(issueNumber, repo);
    },
  });

  // Mount dashboard and health routes
  const dashboardRoutes = createDashboardRoutes(store, queue);
  const healthRoutes = createHealthRoutes(queue);
  app.route("/", dashboardRoutes);
  app.route("/", healthRoutes);

  // Serve cached dashboard HTML at GET /
  app.get("/", (c) => {
    if (!dashboardHtml) return c.text("Dashboard UI not found", 404);
    return c.html(dashboardHtml);
  });

  startServer(app, port);
  logger.info(`Dashboard available at http://localhost:${port}/`);
}

async function setupCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  await runSetup(aqRoot);
}

async function statusCommand(args: CliArgs): Promise<void> {
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

async function cleanupCommand(args: CliArgs): Promise<void> {
  const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
  const config = loadConfig(aqRoot);
  const logger = createLogger(config.general.logLevel);

  logger.info("Starting worktree cleanup...");
  const removed = await cleanOldWorktrees(config.git, config.worktree, { cwd: aqRoot });
  logger.info(`Cleanup complete. Removed ${removed.length} worktree(s).`);
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
  } else if (command === "setup-webhook") {
    if (!args.repo) {
      console.error("Usage: npx tsx src/cli.ts setup-webhook --repo <owner/repo>");
      process.exit(1);
    }
    const aqRoot = args.config ? resolve(args.config, "..") : process.cwd();
    await setupWebhook(aqRoot, args.repo);
  } else if (command === "status") {
    await statusCommand(args);
  } else if (command === "cleanup") {
    await cleanupCommand(args);
  } else if (command === "help") {
    printHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
AI 병참부 (AI Quartermaster)

Usage:
  aqm setup                                          Initial setup
  aqm setup-webhook --repo <owner/repo>              Register GitHub webhook
  aqm run --issue <number> --repo <owner/repo>       Run pipeline for an issue
  aqm start [--port <n>]                             Start webhook server (foreground)
  aqm start --daemon                                 Start server in background
  aqm stop                                           Stop background server
  aqm restart                                        Restart background server
  aqm logs                                           Tail server logs
  aqm status                                         Show queue status
  aqm cleanup                                        Clean old worktrees
  aqm update                                         Update to latest version
  aqm version                                        Show version info
  aqm help                                           Show this help

  (또는 npx tsx src/cli.ts <command> 로 직접 실행 가능)

Options:
  --issue <number>    GitHub issue number
  --repo <owner/repo> GitHub repository
  --config <path>     Path to config.yml (default: ./config.yml)
  --target <path>     Target project path (overrides config)
  --port <number>     Port for webhook server (default: 3000)
  --dry-run           Skip external actions (push, PR creation)

Environment:
  GITHUB_WEBHOOK_SECRET   Required for webhook signature verification
  SMEE_URL                Smee.io channel URL for webhook proxy
  AQM_HOME                Installation directory (default: ~/.ai-quartermaster)
`);
}

function parseArgs(argv: string[]): CliArgs {
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
    }
  }
  return result;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
