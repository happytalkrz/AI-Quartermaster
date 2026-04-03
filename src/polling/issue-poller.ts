import { getLogger } from "../utils/logger.js";
import { runCli } from "../utils/cli-runner.js";
import { JobStore } from "../queue/job-store.js";
import { JobQueue } from "../queue/job-queue.js";
import { AQConfig } from "../types/config.js";
import { SelfUpdater, UpdateInfo } from "../update/self-updater.js";

const logger = getLogger();

interface RawIssue {
  number: number;
  title: string;
  labels: Array<{ name: string } | string>;
}

type UpdateAvailableCallback = (updateInfo: UpdateInfo) => void | Promise<void>;

export class IssuePoller {
  private config: AQConfig;
  private store: JobStore;
  private queue: JobQueue;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private selfUpdater: SelfUpdater;
  private onUpdateAvailable?: UpdateAvailableCallback;

  constructor(
    config: AQConfig,
    store: JobStore,
    queue: JobQueue,
    onUpdateAvailable?: UpdateAvailableCallback
  ) {
    this.config = config;
    this.store = store;
    this.queue = queue;
    this.onUpdateAvailable = onUpdateAvailable;
    this.selfUpdater = new SelfUpdater(config.git, {
      cwd: process.cwd(),
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`폴링 모드 시작 — 간격: ${this.config.general.pollingIntervalMs}ms`);
    // 첫 폴링 즉시 실행, 이후 interval 적용
    this.poll().then(() => this.scheduleNext()).catch(() => this.scheduleNext());
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("폴링 모드 중지");
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.poll();
      this.scheduleNext();
    }, this.config.general.pollingIntervalMs);
  }

  private async poll(): Promise<void> {
    const projects = this.config.projects ?? [];
    const triggerLabels = this.config.safety.allowedLabels;
    const ghPath = this.config.commands.ghCli.path;
    const ghTimeout = this.config.commands.ghCli.timeout;

    logger.debug(`폴링 사이클 시작 — 프로젝트 ${projects.length}개, 레이블: [${triggerLabels.join(", ")}]`);

    // Check for updates if auto-update is enabled
    if (this.config.general.autoUpdate && this.onUpdateAvailable) {
      await this.checkForUpdates();
    }

    const tasks = projects.flatMap(p =>
      triggerLabels.map(l => this.pollProjectLabel(p.repo, l, ghPath, ghTimeout))
    );
    await Promise.allSettled(tasks);
  }

  private async checkForUpdates(): Promise<void> {
    try {
      logger.debug("업데이트 확인 시작");
      const updateInfo = await this.selfUpdater.checkForUpdates();

      if (updateInfo.hasUpdates && this.onUpdateAvailable) {
        logger.info(`새 업데이트 감지 — ${updateInfo.currentHash.substring(0, 8)} -> ${updateInfo.remoteHash.substring(0, 8)}`);
        await this.onUpdateAvailable(updateInfo);
      }
    } catch (err) {
      logger.warn(`업데이트 확인 중 오류: ${err}`);
    }
  }

  private async pollProjectLabel(
    repo: string,
    label: string,
    ghPath: string,
    timeout: number
  ): Promise<void> {
    let issues: RawIssue[];
    try {
      const result = await runCli(
        ghPath,
        [
          "issue", "list",
          "--repo", repo,
          "--label", label,
          "--state", "open",
          "--json", "number,title,labels",
          "--limit", "100",
        ],
        { timeout }
      );

      if (result.exitCode !== 0) {
        logger.warn(`이슈 목록 조회 실패 (${repo}, label=${label}): ${result.stderr || result.stdout}`);
        return;
      }

      issues = JSON.parse(result.stdout) as RawIssue[];
    } catch (err) {
      logger.warn(`폴링 중 오류 (${repo}, label=${label}): ${err}`);
      return;
    }

    logger.debug(`${repo} — 레이블 "${label}" 오픈 이슈 ${issues.length}개 조회됨`);

    // 이슈 번호 오름차순 (오래된 이슈 먼저 처리)
    issues.sort((a, b) => a.number - b.number);

    for (const issue of issues) {
      if (this.store.shouldBlockRepickup(issue.number, repo)) {
        logger.debug(`이슈 #${issue.number} (${repo}) — 재픽업 차단 (성공한 잡 존재), 건너뜀`);
        continue;
      }
      logger.info(`새 이슈 발견 — #${issue.number} "${issue.title}" (${repo}), 큐에 추가`);
      this.queue.enqueue(issue.number, repo);
    }
  }
}
