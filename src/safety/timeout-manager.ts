import { TimeoutError } from "../types/errors.js";

/**
 * Wraps an async operation with a timeout.
 * Uses AbortController pattern for clean cancellation.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  stage: string
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(stage, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(controller.signal), timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (error: unknown) {
    clearTimeout(timer!);
    throw error;
  }
}

/**
 * Creates a pipeline-level timeout tracker.
 * Tracks total elapsed time and can check if the pipeline should be aborted.
 */
export class PipelineTimer {
  private startTime: number;

  constructor(private maxDurationMs: number) {
    this.startTime = Date.now();
  }

  get elapsed(): number {
    return Date.now() - this.startTime;
  }

  get remaining(): number {
    return Math.max(0, this.maxDurationMs - this.elapsed);
  }

  get isExpired(): boolean {
    return this.elapsed >= this.maxDurationMs;
  }

  assertNotExpired(stage: string): void {
    if (this.isExpired) {
      throw new TimeoutError(stage, this.maxDurationMs);
    }
  }
}
