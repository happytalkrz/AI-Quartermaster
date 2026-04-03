import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import type { GitConfig } from "../types/config.js";

const logger = getLogger();

export interface UpdateInfo {
  hasUpdates: boolean;
  currentHash: string;
  remoteHash: string;
  packageLockChanged: boolean;
}

export interface SelfUpdaterOptions {
  cwd: string;
}

/**
 * Self-updater module for AQM
 * Detects updates from origin/main and performs git pull + npm ci when needed
 */
export class SelfUpdater {
  constructor(private gitConfig: GitConfig, private options: SelfUpdaterOptions) {}

  /**
   * Checks if there are new commits on origin/main compared to current HEAD
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    logger.debug("업데이트 확인 중...");

    // Fetch latest from remote
    const fetchResult = await runCli(
      this.gitConfig.gitPath,
      ["fetch", this.gitConfig.remoteAlias, this.gitConfig.defaultBaseBranch],
      { cwd: this.options.cwd }
    );
    if (fetchResult.exitCode !== 0) {
      throw new Error(`git fetch 실패: ${fetchResult.stderr}`);
    }

    // Get current HEAD hash
    const currentResult = await runCli(
      this.gitConfig.gitPath,
      ["rev-parse", "HEAD"],
      { cwd: this.options.cwd }
    );
    if (currentResult.exitCode !== 0) {
      throw new Error(`현재 커밋 해시 조회 실패: ${currentResult.stderr}`);
    }
    const currentHash = currentResult.stdout.trim();

    // Get remote HEAD hash
    const remoteRef = `${this.gitConfig.remoteAlias}/${this.gitConfig.defaultBaseBranch}`;
    const remoteResult = await runCli(
      this.gitConfig.gitPath,
      ["rev-parse", remoteRef],
      { cwd: this.options.cwd }
    );
    if (remoteResult.exitCode !== 0) {
      throw new Error(`원격 커밋 해시 조회 실패: ${remoteResult.stderr}`);
    }
    const remoteHash = remoteResult.stdout.trim();

    const hasUpdates = currentHash !== remoteHash;

    // If there are updates, check if package-lock.json changed
    let packageLockChanged = false;
    if (hasUpdates) {
      packageLockChanged = await this.checkPackageLockChanges(currentHash, remoteHash);
    }

    logger.debug(`업데이트 확인 완료 — 현재: ${currentHash.substring(0, 8)}, 원격: ${remoteHash.substring(0, 8)}, 업데이트: ${hasUpdates}, package-lock 변경: ${packageLockChanged}`);

    return {
      hasUpdates,
      currentHash,
      remoteHash,
      packageLockChanged,
    };
  }

  /**
   * Checks if package-lock.json has changed between two commits
   */
  private async checkPackageLockChanges(fromHash: string, toHash: string): Promise<boolean> {
    const diffResult = await runCli(
      this.gitConfig.gitPath,
      ["diff", "--name-only", fromHash, toHash, "--", "package-lock.json"],
      { cwd: this.options.cwd }
    );
    if (diffResult.exitCode !== 0) {
      logger.warn(`package-lock.json 변경 확인 실패: ${diffResult.stderr}`);
      return false;
    }
    return diffResult.stdout.trim().length > 0;
  }

  /**
   * Performs git pull to update to latest commits
   */
  async pullUpdates(): Promise<void> {
    logger.info("업데이트 적용 중 — git pull 실행...");

    const pullResult = await runCli(
      this.gitConfig.gitPath,
      ["pull", this.gitConfig.remoteAlias, this.gitConfig.defaultBaseBranch],
      { cwd: this.options.cwd }
    );
    if (pullResult.exitCode !== 0) {
      throw new Error(`git pull 실패: ${pullResult.stderr}`);
    }

    logger.info("git pull 완료");
  }

  /**
   * Determines if npm ci should be run based on package-lock.json changes
   */
  shouldRunNpmCi(updateInfo: UpdateInfo): boolean {
    return updateInfo.hasUpdates && updateInfo.packageLockChanged;
  }

  /**
   * Runs npm ci to install dependencies
   */
  async runNpmCi(): Promise<void> {
    logger.info("의존성 설치 중 — npm ci 실행...");

    const npmCiResult = await runCli(
      "npm",
      ["ci"],
      {
        cwd: this.options.cwd,
        timeout: 300000, // 5분 타임아웃
      }
    );
    if (npmCiResult.exitCode !== 0) {
      throw new Error(`npm ci 실패: ${npmCiResult.stderr}`);
    }

    logger.info("npm ci 완료");
  }

  /**
   * Performs full self-update process: check -> pull -> npm ci (if needed)
   */
  async performSelfUpdate(): Promise<{ updated: boolean; needsRestart: boolean }> {
    const updateInfo = await this.checkForUpdates();

    if (!updateInfo.hasUpdates) {
      logger.debug("업데이트 없음");
      return { updated: false, needsRestart: false };
    }

    logger.info(`새 업데이트 발견 — ${updateInfo.currentHash.substring(0, 8)} -> ${updateInfo.remoteHash.substring(0, 8)}`);

    await this.pullUpdates();

    if (this.shouldRunNpmCi(updateInfo)) {
      await this.runNpmCi();
    }

    logger.info("자가 업데이트 완료");
    return { updated: true, needsRestart: true };
  }
}