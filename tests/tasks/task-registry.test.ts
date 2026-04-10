import { describe, it, expect, beforeEach } from "vitest";
import { TaskRegistry } from "../../src/tasks/task-registry.js";
import type { TaskFactory } from "../../src/tasks/task-factory.js";
import type { AQMTask, AQMTaskSummary } from "../../src/tasks/aqm-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { Job } from "../../src/types/pipeline.js";

function makeFactory(idPrefix: string): TaskFactory {
  return {
    create: (job: Job): AQMTask => ({
      id: `${idPrefix}-${job.issueNumber}`,
      type: "claude" as const,
      get status() {
        return TaskStatus.PENDING;
      },
      async kill() {},
      toJSON(): AQMTaskSummary {
        return {
          id: `${idPrefix}-${job.issueNumber}`,
          type: "claude",
          status: TaskStatus.PENDING,
        };
      },
    }),
  };
}

const mockJob: Job = {
  id: "job-1",
  issueNumber: 42,
  repo: "owner/repo",
  status: "queued",
  createdAt: new Date().toISOString(),
};

describe("TaskRegistry", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  describe("register / has / get", () => {
    it("팩토리를 등록하고 has로 확인할 수 있어야 한다", () => {
      expect(registry.has("claude")).toBe(false);
      registry.register("claude", makeFactory("claude"));
      expect(registry.has("claude")).toBe(true);
    });

    it("get으로 등록된 팩토리를 반환해야 한다", () => {
      const factory = makeFactory("claude");
      registry.register("claude", factory);
      expect(registry.get("claude")).toBe(factory);
    });

    it("미등록 타입에 대해 get은 undefined를 반환해야 한다", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });

    it("같은 타입을 재등록하면 덮어써야 한다", () => {
      const first = makeFactory("first");
      const second = makeFactory("second");
      registry.register("claude", first);
      registry.register("claude", second);
      expect(registry.get("claude")).toBe(second);
    });
  });

  describe("create", () => {
    it("등록된 팩토리로 태스크를 생성해야 한다", () => {
      registry.register("claude", makeFactory("claude"));
      const task = registry.create("claude", mockJob);
      expect(task.id).toBe("claude-42");
    });

    it("미등록 타입으로 create하면 에러를 던져야 한다", () => {
      expect(() => registry.create("unknown", mockJob)).toThrow(
        "No factory registered for task type: unknown"
      );
    });
  });

  describe("getRegisteredTypes", () => {
    it("등록된 타입 목록을 반환해야 한다", () => {
      registry.register("claude", makeFactory("claude"));
      registry.register("git", makeFactory("git"));
      const types = registry.getRegisteredTypes();
      expect(types).toContain("claude");
      expect(types).toContain("git");
      expect(types).toHaveLength(2);
    });

    it("아무것도 등록되지 않으면 빈 배열을 반환해야 한다", () => {
      expect(registry.getRegisteredTypes()).toEqual([]);
    });
  });
});
