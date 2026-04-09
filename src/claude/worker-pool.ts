import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

export type WorkerStatus = "idle" | "busy";

export interface Worker {
  id: string;
  status: WorkerStatus;
}

export type WorkerTaskHandler<TInput, TOutput> = (
  input: TInput,
  workerId: string
) => Promise<TOutput>;

interface PendingTask<TInput, TOutput> {
  input: TInput;
  resolve: (value: TOutput) => void;
  reject: (reason: unknown) => void;
}

/**
 * 최대 N개의 워커를 동시에 관리하는 워커 풀.
 * 초과 태스크는 내부 큐에 대기시키고 워커가 idle 상태가 되면 순서대로 처리한다.
 */
export class WorkerPool<TInput, TOutput> {
  private maxWorkers: number;
  private workers: Map<string, Worker>;
  private pending: PendingTask<TInput, TOutput>[];
  private handler: WorkerTaskHandler<TInput, TOutput>;
  private isProcessing: boolean;
  private needsReprocess: boolean;
  private shuttingDown: boolean;
  private nextWorkerId: number;

  constructor(maxWorkers: number, handler: WorkerTaskHandler<TInput, TOutput>) {
    if (maxWorkers <= 0 || !Number.isInteger(maxWorkers)) {
      throw new Error("maxWorkers must be a positive integer");
    }
    this.maxWorkers = maxWorkers;
    this.handler = handler;
    this.workers = new Map();
    this.pending = [];
    this.isProcessing = false;
    this.needsReprocess = false;
    this.shuttingDown = false;
    this.nextWorkerId = 1;
  }

  private get busyCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === "busy") count++;
    }
    return count;
  }

  private getIdleWorker(): Worker | undefined {
    for (const worker of this.workers.values()) {
      if (worker.status === "idle") return worker;
    }
    return undefined;
  }

  /**
   * 태스크를 풀에 제출한다. 가용 워커가 있으면 즉시 실행, 없으면 큐에 대기.
   */
  submit(input: TInput): Promise<TOutput> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("WorkerPool is shutting down"));
    }

    return new Promise<TOutput>((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
      this.processNext();
    });
  }

  private processNext(): void {
    // Prevent re-entrancy
    if (this.isProcessing) {
      this.needsReprocess = true;
      return;
    }

    this.isProcessing = true;
    this.needsReprocess = false;

    try {
      while (this.pending.length > 0 && this.busyCount < this.maxWorkers) {
        const task = this.pending.shift()!;

        // Reuse idle worker or create a new one
        let worker = this.getIdleWorker();
        if (!worker) {
          const workerId = `worker-${this.nextWorkerId++}`;
          worker = { id: workerId, status: "idle" };
          this.workers.set(workerId, worker);
          logger.debug(`WorkerPool: created ${workerId} (total: ${this.workers.size})`);
        }

        worker.status = "busy";
        logger.debug(
          `WorkerPool: ${worker.id} started task (busy: ${this.busyCount}/${this.maxWorkers}, pending: ${this.pending.length})`
        );

        this.runTask(worker.id, task);
      }
    } finally {
      this.isProcessing = false;

      if (this.needsReprocess) {
        setImmediate(() => this.processNext());
      }
    }
  }

  private runTask(workerId: string, task: PendingTask<TInput, TOutput>): void {
    this.handler(task.input, workerId)
      .then((result) => {
        task.resolve(result);
      })
      .catch((err: unknown) => {
        logger.error(`WorkerPool: ${workerId} task failed: ${getErrorMessage(err)}`);
        task.reject(err);
      })
      .finally(() => {
        const worker = this.workers.get(workerId);
        if (worker) {
          worker.status = "idle";
          logger.debug(`WorkerPool: ${workerId} idle (pending: ${this.pending.length})`);
        }
        // Defer to avoid deep call stacks
        setImmediate(() => this.processNext());
      });
  }

  /**
   * 현재 풀 상태를 반환한다.
   */
  getStatus(): { maxWorkers: number; busy: number; idle: number; pending: number } {
    const busy = this.busyCount;
    return {
      maxWorkers: this.maxWorkers,
      busy,
      idle: this.workers.size - busy,
      pending: this.pending.length,
    };
  }

  /**
   * 생성된 워커 목록을 반환한다.
   */
  getWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  /**
   * 최대 워커 수를 변경하고 즉시 처리를 시도한다.
   */
  setMaxWorkers(n: number): void {
    if (n <= 0 || !Number.isInteger(n)) {
      throw new Error("maxWorkers must be a positive integer");
    }
    this.maxWorkers = n;
    logger.info(`WorkerPool: maxWorkers updated to ${n}`);
    this.processNext();
  }

  /**
   * 풀을 종료한다. 대기 중인 태스크는 즉시 거부하고,
   * 실행 중인 워커가 완료될 때까지 기다린다 (timeoutMs 이내).
   */
  shutdown(timeoutMs: number = 30000): Promise<void> {
    this.shuttingDown = true;

    // Reject all pending tasks immediately
    const pending = this.pending.splice(0);
    for (const task of pending) {
      task.reject(new Error("WorkerPool is shutting down"));
    }

    if (this.busyCount === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (this.busyCount === 0) {
          clearInterval(check);
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(check);
          logger.warn(
            `WorkerPool shutdown timeout: ${this.busyCount} worker(s) still busy after ${timeoutMs / 1000}s`
          );
          resolve();
        }
      }, 100);
    });
  }
}
