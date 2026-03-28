import { getLogger } from "../utils/logger.js";
import { runCli } from "../utils/cli-runner.js";
import { JobStore } from "../queue/job-store.js";
import { JobQueue } from "../queue/job-queue.js";
import { AQConfig } from "../types/config.js";

const logger = getLogger();

interface RawIssue {
  number: number;
  title: string;
  labels: Array<{ name: string } | string>;
}

export class IssuePoller {
  private config: AQConfig;
  private store: JobStore;
  private queue: JobQueue;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(config: AQConfig, store: JobStore, queue: JobQueue) {
    this.config = config;
    this.store = store;
    this.queue = queue;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`폴링 모드 시작 — 간격: ${this.config.general.pollingIntervalMs}ms`);
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("폴링 모드 중지");
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

    const tasks = projects.flatMap(p =>
      triggerLabels.map(l => this.pollProjectLabel(p.repo, l, ghPath, ghTimeout))
    );
    await Promise.allSettled(tasks);
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
      const existing = this.store.findAnyByIssue(issue.number, repo);
      if (existing) {
        logger.debug(`이슈 #${issue.number} (${repo}) — 이미 처리됨 (${existing.id}, 상태: ${existing.status}), 건너뜀`);
        continue;
      }
      logger.info(`새 이슈 발견 — #${issue.number} "${issue.title}" (${repo}), 큐에 추가`);
      this.queue.enqueue(issue.number, repo);
    }
  }
}
