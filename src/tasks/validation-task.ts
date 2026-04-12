import { randomUUID } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { AQMTask, TaskStatus, type AQMTaskSummary, type BaseTaskOptions } from "./aqm-task.js";
import {
  parseTscOutput,
  parseVitestOutput,
  parseEslintOutput,
  type TscParseResult,
  type VitestParseResult,
  type EslintParseResult,
} from "../pipeline/reporting/verification-parser.js";

export type ValidationTaskType = "typecheck" | "lint" | "test";

export interface ValidationResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  parsed: TscParseResult | VitestParseResult | EslintParseResult;
}

export interface ValidationTaskOptions extends BaseTaskOptions {
  validationType: ValidationTaskType;
  command: string;
  args: string[];
  timeout?: number;
}

/**
 * typecheck/lint/test 명령을 spawn으로 실행하고 결과를 파싱하는 AQMTask 구현체
 */
export class ValidationTask implements AQMTask {
  public readonly id: string;
  public readonly type = "validation" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: ValidationResult;
  private _child?: ChildProcess;
  private readonly _options: ValidationTaskOptions;

  constructor(options: ValidationTaskOptions) {
    this.id = options.id ?? randomUUID();
    this._options = { ...options, id: this.id };
  }

  get status(): TaskStatus {
    return this._status;
  }

  async run(): Promise<ValidationResult> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already ${this._status} and cannot be run again`);
    }

    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();

    try {
      const result = await this._spawnCommand();
      this._completedAt = new Date();
      this._status = result.exitCode === 0 ? TaskStatus.SUCCESS : TaskStatus.FAILED;
      this._result = result;
      return result;
    } catch (err: unknown) {
      this._completedAt = new Date();
      this._status = TaskStatus.FAILED;
      const durationMs = this._completedAt.getTime() - (this._startedAt?.getTime() ?? 0);
      this._result = {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs,
        parsed: this._parseOutput("", ""),
      };
      throw err;
    }
  }

  private _spawnCommand(): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      const startTime = this._startedAt?.getTime() ?? Date.now();
      let stdout = "";
      let stderr = "";

      this._child = spawn(this._options.command, this._options.args, {
        cwd: this._options.cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      this._child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      this._child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      this._child.on("close", (code) => {
        this._child = undefined;
        const exitCode = code ?? 1;
        const durationMs = Date.now() - startTime;
        resolve({
          success: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          durationMs,
          parsed: this._parseOutput(stdout, stderr),
        });
      });

      this._child.on("error", (err) => {
        this._child = undefined;
        reject(err);
      });

      if (this._options.timeout) {
        setTimeout(() => {
          this._child?.kill("SIGTERM");
        }, this._options.timeout);
      }
    });
  }

  private _parseOutput(
    stdout: string,
    stderr: string,
  ): TscParseResult | VitestParseResult | EslintParseResult {
    const combined = stdout + "\n" + stderr;
    switch (this._options.validationType) {
      case "typecheck":
        return parseTscOutput(combined);
      case "test":
        return parseVitestOutput(combined);
      case "lint":
        return parseEslintOutput(combined);
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    if (this._child) {
      try {
        this._child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this._child?.kill("SIGKILL");
      } catch {
        // 프로세스가 이미 종료되었거나 권한 없음 — 무시
      }
    }

    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
    this._child = undefined;
  }

  toJSON(): AQMTaskSummary {
    const durationMs =
      this._completedAt && this._startedAt
        ? this._completedAt.getTime() - this._startedAt.getTime()
        : undefined;

    return {
      id: this.id,
      type: this.type,
      status: this.status,
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      durationMs,
      metadata: {
        ...this._options.metadata,
        validationType: this._options.validationType,
        command: this._options.command,
        args: this._options.args,
        success: this._result?.success,
        exitCode: this._result?.exitCode,
      },
    };
  }

  getResult(): ValidationResult | undefined {
    return this._result;
  }
}
