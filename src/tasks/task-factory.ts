import type { Job } from "../types/pipeline.js";
import type { AQMTask } from "./aqm-task.js";
import { ClaudeTask } from "./claude-task.js";
import type { ClaudeCliConfig } from "../types/config.js";

/**
 * 잡 타입별 AQMTask 인스턴스를 생성하는 팩토리 인터페이스
 */
export interface TaskFactory {
  /**
   * 주어진 Job으로부터 AQMTask 인스턴스를 생성
   * @param job 실행할 잡 정보
   * @returns 생성된 AQMTask 인스턴스
   */
  create(job: Job): AQMTask;
}

/**
 * DefaultTaskFactory 생성 옵션
 */
export interface DefaultTaskFactoryOptions {
  /** Claude CLI 설정 */
  config: ClaudeCliConfig;
  /** 작업 디렉토리 (선택사항, 미지정 시 process.cwd() 사용) */
  cwd?: string;
  /**
   * Job으로부터 프롬프트를 생성하는 함수 (선택사항)
   * 미지정 시 이슈 번호와 레포 정보를 사용한 기본 프롬프트 생성
   */
  promptBuilder?: (job: Job) => string;
}

/**
 * ClaudeTask를 기본으로 생성하는 TaskFactory 구현체
 * ValidationTask/GitTask 등이 추가되기 전까지 모든 잡을 ClaudeTask로 처리한다
 */
export class DefaultTaskFactory implements TaskFactory {
  private readonly config: ClaudeCliConfig;
  private readonly cwd?: string;
  private readonly promptBuilder: (job: Job) => string;

  constructor(options: DefaultTaskFactoryOptions) {
    this.config = options.config;
    this.cwd = options.cwd;
    this.promptBuilder = options.promptBuilder ?? DefaultTaskFactory.buildDefaultPrompt;
  }

  create(job: Job): AQMTask {
    return new ClaudeTask({
      prompt: this.promptBuilder(job),
      config: this.config,
      cwd: this.cwd,
      metadata: {
        jobId: job.id,
        issueNumber: job.issueNumber,
        repo: job.repo,
      },
    });
  }

  private static buildDefaultPrompt(job: Job): string {
    return `이슈 #${job.issueNumber} (${job.repo}) 처리`;
  }
}
