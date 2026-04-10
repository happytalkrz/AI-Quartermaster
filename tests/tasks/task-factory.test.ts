import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskFactory } from "../../src/tasks/task-factory.js";
import { DefaultTaskFactory } from "../../src/tasks/task-factory.js";
import type { AQMTask, AQMTaskSummary } from "../../src/tasks/aqm-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import { ClaudeTask } from "../../src/tasks/claude-task.js";
import type { Job } from "../../src/types/pipeline.js";
import { getActiveProcessPids } from "../../src/claude/claude-runner.js";

vi.mock("../../src/claude/claude-runner.js");
vi.mocked(getActiveProcessPids).mockReturnValue([]);

const testConfig = {
  path: "claude",
  model: "sonnet",
  models: {
    plan: "claude-opus-4-6",
    phase: "claude-sonnet-4-6",
    review: "claude-haiku-4-5-20251001",
    fallback: "claude-sonnet-4-6",
  },
  maxTurns: 10,
  timeout: 30000,
  additionalArgs: [],
};

const mockJob: Job = {
  id: "job-1",
  issueNumber: 1,
  repo: "owner/repo",
  status: "queued",
  createdAt: new Date().toISOString(),
};

describe("TaskFactory 인터페이스", () => {
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

describe("DefaultTaskFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveProcessPids).mockReturnValue([]);
  });

  describe("생성", () => {
    it("config만으로 생성할 수 있어야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      expect(factory).toBeDefined();
    });

    it("모든 옵션으로 생성할 수 있어야 한다", () => {
      const factory = new DefaultTaskFactory({
        config: testConfig,
        cwd: "/custom/path",
        promptBuilder: (job: Job) => `prompt for #${job.issueNumber}`,
      });
      expect(factory).toBeDefined();
    });
  });

  describe("create()", () => {
    it("ClaudeTask를 생성해야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      const task = factory.create(mockJob);

      expect(task).toBeInstanceOf(ClaudeTask);
      expect(task.type).toBe("claude");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("호출마다 고유한 태스크 ID를 생성해야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      const task1 = factory.create(mockJob);
      const task2 = factory.create(mockJob);

      expect(task1.id).not.toBe(task2.id);
    });

    it("Job 메타데이터를 태스크에 포함해야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      const task = factory.create(mockJob);
      const json = task.toJSON();

      expect(json.metadata).toMatchObject({
        jobId: mockJob.id,
        issueNumber: mockJob.issueNumber,
        repo: mockJob.repo,
      });
    });

    it("기본 프롬프트에 이슈 번호와 레포가 포함되어야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      const task = factory.create(mockJob);
      const json = task.toJSON();

      expect(json.metadata?.prompt).toContain("1");
      expect(json.metadata?.prompt).toContain("owner/repo");
    });

    it("커스텀 promptBuilder가 적용되어야 한다", () => {
      const customPrompt = "custom: implement feature";
      const factory = new DefaultTaskFactory({
        config: testConfig,
        promptBuilder: () => customPrompt,
      });
      const task = factory.create(mockJob);
      const json = task.toJSON();

      expect(json.metadata?.prompt).toBe(customPrompt);
    });

    it("다른 Job 상태에서도 ClaudeTask로 fallback해야 한다", () => {
      const runningJob: Job = {
        ...mockJob,
        status: "running",
        startedAt: new Date().toISOString(),
      };

      const factory = new DefaultTaskFactory({ config: testConfig });
      const task = factory.create(runningJob);

      expect(task).toBeInstanceOf(ClaudeTask);
      expect(task.type).toBe("claude");
    });

    it("여러 Job에 대해 독립적인 태스크를 생성해야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });

      const job1: Job = { ...mockJob, id: "job-1", issueNumber: 10 };
      const job2: Job = { ...mockJob, id: "job-2", issueNumber: 20 };

      const task1 = factory.create(job1);
      const task2 = factory.create(job2);

      expect(task1.id).not.toBe(task2.id);
      expect(task1.toJSON().metadata?.issueNumber).toBe(10);
      expect(task2.toJSON().metadata?.issueNumber).toBe(20);
    });
  });

  describe("TaskFactory 인터페이스 준수", () => {
    it("create 메서드가 AQMTask 인터페이스를 충족해야 한다", () => {
      const factory = new DefaultTaskFactory({ config: testConfig });
      const task = factory.create(mockJob);

      expect(typeof task.id).toBe("string");
      expect(task.id.length).toBeGreaterThan(0);
      expect(typeof task.type).toBe("string");
      expect(typeof task.status).toBe("string");
      expect(typeof task.kill).toBe("function");
      expect(typeof task.toJSON).toBe("function");
    });
  });
});
