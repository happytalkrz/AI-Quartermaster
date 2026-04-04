import { describe, it, expect } from "vitest";
import {
  TaskStatus,
  AQMTaskType,
  AQMTaskSummary,
  AQMTask,
  BaseTaskOptions
} from "../../src/tasks/aqm-task.js";

describe("AQMTask 인터페이스 및 타입 정의", () => {
  describe("TaskStatus enum", () => {
    it("should define all required task states", () => {
      expect(TaskStatus.PENDING).toBe("PENDING");
      expect(TaskStatus.RUNNING).toBe("RUNNING");
      expect(TaskStatus.SUCCESS).toBe("SUCCESS");
      expect(TaskStatus.FAILED).toBe("FAILED");
      expect(TaskStatus.KILLED).toBe("KILLED");
    });

    it("should have exactly 5 status values", () => {
      const statusValues = Object.values(TaskStatus);
      expect(statusValues).toHaveLength(5);
      expect(statusValues).toEqual([
        "PENDING",
        "RUNNING",
        "SUCCESS",
        "FAILED",
        "KILLED"
      ]);
    });
  });

  describe("AQMTaskType", () => {
    it("should accept supported task types", () => {
      // Type-only test: verify the type accepts expected values
      const claudeType: AQMTaskType = "claude";
      const codexType: AQMTaskType = "codex";
      const geminiType: AQMTaskType = "gemini";

      expect(claudeType).toBe("claude");
      expect(codexType).toBe("codex");
      expect(geminiType).toBe("gemini");
    });
  });

  describe("AQMTaskSummary interface", () => {
    it("should accept all required and optional fields", () => {
      // Type-only test: verify interface structure
      const summary: AQMTaskSummary = {
        id: "test-id",
        type: "claude",
        status: TaskStatus.SUCCESS
      };

      expect(summary.id).toBe("test-id");
      expect(summary.type).toBe("claude");
      expect(summary.status).toBe(TaskStatus.SUCCESS);
    });

    it("should accept optional timestamp and metadata fields", () => {
      const summary: AQMTaskSummary = {
        id: "test-id",
        type: "claude",
        status: TaskStatus.SUCCESS,
        startedAt: "2026-04-04T15:00:00.000Z",
        completedAt: "2026-04-04T15:01:00.000Z",
        durationMs: 60000,
        metadata: {
          prompt: "test prompt",
          customField: "value"
        }
      };

      expect(summary.startedAt).toBe("2026-04-04T15:00:00.000Z");
      expect(summary.completedAt).toBe("2026-04-04T15:01:00.000Z");
      expect(summary.durationMs).toBe(60000);
      expect(summary.metadata).toEqual({
        prompt: "test prompt",
        customField: "value"
      });
    });
  });

  describe("BaseTaskOptions interface", () => {
    it("should accept all optional fields", () => {
      // Type-only test: verify all fields are optional
      const options1: BaseTaskOptions = {};
      const options2: BaseTaskOptions = {
        id: "custom-id",
        cwd: "/custom/path",
        metadata: { key: "value" }
      };

      expect(options1).toEqual({});
      expect(options2.id).toBe("custom-id");
      expect(options2.cwd).toBe("/custom/path");
      expect(options2.metadata).toEqual({ key: "value" });
    });
  });

  describe("AQMTask interface", () => {
    // Create a minimal implementation for testing
    class TestTask implements AQMTask {
      readonly id = "test-task";
      readonly type: AQMTaskType = "claude";

      get status() {
        return TaskStatus.PENDING;
      }

      async kill() {
        // Test implementation
      }

      toJSON(): AQMTaskSummary {
        return {
          id: this.id,
          type: this.type,
          status: this.status
        };
      }
    }

    it("should require id and type as readonly properties", () => {
      const task = new TestTask();

      expect(task.id).toBe("test-task");
      expect(task.type).toBe("claude");

      // These should be readonly - TypeScript compilation enforces this
      // @ts-expect-error - readonly property
      // task.id = "new-id";
      // @ts-expect-error - readonly property
      // task.type = "codex";
    });

    it("should require status getter", () => {
      const task = new TestTask();
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should require kill method", async () => {
      const task = new TestTask();

      // Should not throw
      await expect(task.kill()).resolves.toBeUndefined();
    });

    it("should require toJSON method", () => {
      const task = new TestTask();
      const json = task.toJSON();

      expect(json).toEqual({
        id: "test-task",
        type: "claude",
        status: TaskStatus.PENDING
      });
    });
  });
});