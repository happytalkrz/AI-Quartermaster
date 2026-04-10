import { describe, it, expect } from "vitest";
import type { TaskFactory } from "../../src/tasks/task-factory.js";
import type { AQMTask, AQMTaskSummary } from "../../src/tasks/aqm-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { Job } from "../../src/types/pipeline.js";

describe("TaskFactory 인터페이스", () => {
  const mockJob: Job = {
    id: "job-1",
    issueNumber: 1,
    repo: "owner/repo",
    status: "queued",
    createdAt: new Date().toISOString(),
  };

  it("create 메서드가 AQMTask를 반환해야 한다", () => {
    const createdTask: AQMTask = {
      id: "task-1",
      type: "claude",
      get status() {
        return TaskStatus.PENDING;
      },
      async kill() {},
      toJSON(): AQMTaskSummary {
        return { id: "task-1", type: "claude", status: TaskStatus.PENDING };
      },
    };

    const factory: TaskFactory = {
      create: (_job: Job) => createdTask,
    };

    const task = factory.create(mockJob);
    expect(task.id).toBe("task-1");
    expect(task.type).toBe("claude");
    expect(task.status).toBe(TaskStatus.PENDING);
  });

  it("create 메서드가 Job 정보를 활용해 태스크를 생성할 수 있어야 한다", () => {
    const factory: TaskFactory = {
      create: (job: Job) => ({
        id: `task-for-${job.issueNumber}`,
        type: "claude" as const,
        get status() {
          return TaskStatus.PENDING;
        },
        async kill() {},
        toJSON(): AQMTaskSummary {
          return {
            id: `task-for-${job.issueNumber}`,
            type: "claude",
            status: TaskStatus.PENDING,
          };
        },
      }),
    };

    const task = factory.create(mockJob);
    expect(task.id).toBe("task-for-1");
  });
});
