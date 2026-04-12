import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AQMTask, TaskStatus, AQMTaskSummary, BaseTaskOptions, TaskLifecycleEvent, TaskEventListener, SerializedTask } from "./aqm-task.js";
import { runClaude, getActiveProcessPids, type ClaudeRunResult, type ClaudeRunOptions } from "../claude/claude-runner.js";
import type { ClaudeCliConfig } from "../types/config.js";
import { getErrorMessage } from "../utils/error-utils.js";

/**
 * Claude 태스크 실행을 위한 옵션
 * BaseTaskOptions를 확장하여 Claude 특화 옵션 추가
 */
export interface ClaudeTaskOptions extends BaseTaskOptions {
  /** Claude 실행 프롬프트 */
  prompt: string;
  /** Claude CLI 설정 */
  config: ClaudeCliConfig;
  /** 시스템 프롬프트 (선택사항) */
  systemPrompt?: string;
  /** JSON 스키마 강제 구조화 출력 (선택사항) */
  jsonSchema?: string;
  /** 최대 대화 턴 수 (선택사항) */
  maxTurns?: number;
  /** 에이전트 도구 활성화 여부 (선택사항) */
  enableAgents?: boolean;
  /** stderr 라인별 콜백 (선택사항) */
  onStderr?: (line: string) => void;
}

/**
 * Claude CLI를 래핑하는 AQMTask 구현체
 * claude-runner.ts의 기능을 태스크 추상화로 통합 관리
 */
export class ClaudeTask implements AQMTask {
  public readonly id: string;
  public readonly type = "claude" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: ClaudeRunResult;
  private _processId?: number;
  private readonly _options: ClaudeTaskOptions;
  private readonly _emitter = new EventEmitter();

  constructor(options: ClaudeTaskOptions) {
    this.id = options.id || randomUUID();
    this._options = { ...options, id: this.id };
  }

  get status(): TaskStatus {
    // Detect if process ended but status wasn't updated
    if (this._status === "RUNNING" && this._processId) {
      const activePids = getActiveProcessPids();
      if (!activePids.includes(this._processId) && !this._completedAt) {
        this._status = TaskStatus.FAILED;
        this._completedAt = new Date();
      }
    }
    return this._status;
  }

  on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.on(event, listener);
  }

  off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.off(event, listener);
  }

  once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.once(event, listener);
  }

  async run(): Promise<ClaudeRunResult> {
    if (this._status !== "PENDING") {
      throw new Error(`Task ${this.id} is already ${this._status} and cannot be run again`);
    }

    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();
    this._emitter.emit("started");

    try {
      // Claude 실행 옵션 구성
      const runOptions: ClaudeRunOptions = {
        prompt: this._options.prompt,
        cwd: this._options.cwd || process.cwd(),
        config: this._options.config,
        systemPrompt: this._options.systemPrompt,
        jsonSchema: this._options.jsonSchema,
        maxTurns: this._options.maxTurns,
        enableAgents: this._options.enableAgents,
        onStderr: this._options.onStderr,
      };

      // 프로세스 ID 추적을 위한 콜백 래핑
      const originalOnStderr = runOptions.onStderr;
      runOptions.onStderr = (line: string) => {
        // 현재 실행 중인 프로세스 ID 추적
        const activePids = getActiveProcessPids();
        if (activePids.length > 0) {
          this._processId = activePids[activePids.length - 1];
        }
        originalOnStderr?.(line);
      };

      this._result = await runClaude(runOptions);
      this._completedAt = new Date();
      this._status = this._result.success ? TaskStatus.SUCCESS : TaskStatus.FAILED;

      if (this._result.success) {
        this._emitter.emit("completed");
      } else {
        this._emitter.emit("failed");
      }

      return this._result;
    } catch (error: unknown) {
      this._completedAt = new Date();
      this._status = TaskStatus.FAILED;
      this._emitter.emit("failed");

      // 에러를 ClaudeRunResult 형태로 변환
      this._result = {
        success: false,
        output: getErrorMessage(error),
        durationMs: this._completedAt.getTime() - (this._startedAt?.getTime() ?? 0),
      };

      throw error;
    } finally {
      this._processId = undefined;
    }
  }

  async kill(): Promise<void> {
    if (this._status !== "RUNNING") {
      return;
    }

    if (this._processId) {
      try {
        process.kill(this._processId, "SIGTERM");

        // 강제 종료 후 일정 시간 대기
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // 프로세스가 여전히 살아있으면 SIGKILL 사용
        const activePids = getActiveProcessPids();
        if (activePids.includes(this._processId)) {
          process.kill(this._processId, "SIGKILL");
        }
      } catch {
        // 프로세스가 이미 종료되었거나 권한 없음 - 무시
      }
    }

    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
    this._processId = undefined;
    this._emitter.emit("killed");
  }

  toJSON(): AQMTaskSummary {
    const durationMs = this._completedAt && this._startedAt
      ? this._completedAt.getTime() - this._startedAt.getTime()
      : undefined;

    const promptPreview = this._options.prompt.length > 100
      ? this._options.prompt.slice(0, 100) + "..."
      : this._options.prompt;

    return {
      id: this.id,
      type: this.type,
      status: this.status,
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      durationMs,
      metadata: {
        ...this._options.metadata,
        prompt: promptPreview,
        systemPrompt: this._options.systemPrompt,
        maxTurns: this._options.maxTurns,
        enableAgents: this._options.enableAgents,
        success: this._result?.success,
        costUsd: this._result?.costUsd,
        usage: this._result?.usage,
      },
    };
  }

  getResult(): ClaudeRunResult | undefined {
    return this._result;
  }

  /**
   * SerializedTask로부터 ClaudeTask를 복원
   * 복원된 태스크는 PENDING 상태로 시작
   */
  static fromJSON(data: SerializedTask, config: ClaudeCliConfig): ClaudeTask {
    const metadata = data.metadata ?? {};
    const prompt = typeof metadata.prompt === "string" ? metadata.prompt : "";
    const systemPrompt = typeof metadata.systemPrompt === "string" ? metadata.systemPrompt : undefined;
    const maxTurns = typeof metadata.maxTurns === "number" ? metadata.maxTurns : undefined;
    const enableAgents = typeof metadata.enableAgents === "boolean" ? metadata.enableAgents : undefined;

    return new ClaudeTask({
      id: data.id,
      prompt,
      config,
      systemPrompt,
      maxTurns,
      enableAgents,
    });
  }
}