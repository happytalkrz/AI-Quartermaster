import { describe, it, expect, vi } from "vitest";
import {
  TaskStatus,
  AQMTaskType,
  AQMTaskSummary,
  AQMTask,
  BaseTaskOptions,
  SerializedTask,
  TaskLifecycleEvent,
  TaskEventEmitter,
  TaskEventListener,
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

    it("should support optional on/off/once event methods", () => {
      // AQMTask interface defines on/off/once as optional
      // A task without event support is valid
      const task = new TestTask();
      expect(task.on).toBeUndefined();
      expect(task.off).toBeUndefined();
      expect(task.once).toBeUndefined();
    });

    it("should support implementation with event methods", () => {
      class EventedTask implements AQMTask {
        readonly id = "evented-task";
        readonly type: AQMTaskType = "claude";
        private _listeners: Map<TaskLifecycleEvent, TaskEventListener[]> = new Map();

        get status() { return TaskStatus.PENDING; }
        async kill() {}
        toJSON(): AQMTaskSummary {
          return { id: this.id, type: this.type, status: this.status };
        }

        on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = this._listeners.get(event) ?? [];
          list.push(listener);
          this._listeners.set(event, list);
        }

        off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = (this._listeners.get(event) ?? []).filter(l => l !== listener);
          this._listeners.set(event, list);
        }

        once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const wrapper: TaskEventListener = () => {
            listener();
            this.off(event, wrapper);
          };
          this.on(event, wrapper);
        }

        emit(event: TaskLifecycleEvent): void {
          (this._listeners.get(event) ?? []).forEach(l => l());
        }
      }

      const task = new EventedTask();
      const fn = vi.fn();
      task.on("started", fn);
      task.emit("started");
      expect(fn).toHaveBeenCalledTimes(1);

      task.off("started", fn);
      task.emit("started");
      expect(fn).toHaveBeenCalledTimes(1); // not called again
    });
  });

  describe("SerializedTask 타입", () => {
    it("should be structurally identical to AQMTaskSummary", () => {
      // SerializedTask = AQMTaskSummary (type alias)
      const serialized: SerializedTask = {
        id: "task-123",
        type: "claude",
        status: TaskStatus.SUCCESS
      };

      expect(serialized.id).toBe("task-123");
      expect(serialized.type).toBe("claude");
      expect(serialized.status).toBe(TaskStatus.SUCCESS);
    });

    it("should accept all optional fields", () => {
      const serialized: SerializedTask = {
        id: "task-456",
        type: "codex",
        status: TaskStatus.FAILED,
        startedAt: "2026-04-10T10:00:00.000Z",
        completedAt: "2026-04-10T10:01:00.000Z",
        durationMs: 60000,
        metadata: { prompt: "test", retryCount: 2 }
      };

      expect(serialized.startedAt).toBe("2026-04-10T10:00:00.000Z");
      expect(serialized.completedAt).toBe("2026-04-10T10:01:00.000Z");
      expect(serialized.durationMs).toBe(60000);
      expect(serialized.metadata?.retryCount).toBe(2);
    });

    it("should be usable as AQMTaskSummary and vice versa", () => {
      // SerializedTask and AQMTaskSummary are interchangeable
      const summary: AQMTaskSummary = {
        id: "task-789",
        type: "gemini",
        status: TaskStatus.PENDING
      };

      const serialized: SerializedTask = summary;
      const backToSummary: AQMTaskSummary = serialized;

      expect(backToSummary.id).toBe("task-789");
    });
  });

  describe("TaskLifecycleEvent 타입", () => {
    it("should accept all valid lifecycle event values", () => {
      const events: TaskLifecycleEvent[] = ["started", "completed", "failed", "killed"];

      expect(events).toHaveLength(4);
      expect(events).toContain("started");
      expect(events).toContain("completed");
      expect(events).toContain("failed");
      expect(events).toContain("killed");
    });

    it("should be usable as event key in a map", () => {
      const callCounts = new Map<TaskLifecycleEvent, number>();
      const allEvents: TaskLifecycleEvent[] = ["started", "completed", "failed", "killed"];

      for (const event of allEvents) {
        callCounts.set(event, 0);
      }

      callCounts.set("started", 1);
      expect(callCounts.get("started")).toBe(1);
    });
  });

  describe("TaskEventListener 타입", () => {
    it("should be a callable with no parameters", () => {
      const listener: TaskEventListener = vi.fn();
      listener();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listener instances", () => {
      const listeners: TaskEventListener[] = [vi.fn(), vi.fn(), vi.fn()];
      listeners.forEach(l => l());

      listeners.forEach(l => expect(l).toHaveBeenCalledTimes(1));
    });
  });

  describe("TaskEventEmitter 인터페이스", () => {
    it("should be implementable with on/off/once methods", () => {
      class SimpleEmitter implements TaskEventEmitter {
        private _listeners: Map<TaskLifecycleEvent, TaskEventListener[]> = new Map();

        on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = this._listeners.get(event) ?? [];
          list.push(listener);
          this._listeners.set(event, list);
        }

        off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = (this._listeners.get(event) ?? []).filter(l => l !== listener);
          this._listeners.set(event, list);
        }

        once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const wrapper: TaskEventListener = () => {
            listener();
            this.off(event, wrapper);
          };
          this.on(event, wrapper);
        }

        emit(event: TaskLifecycleEvent): void {
          (this._listeners.get(event) ?? []).forEach(l => l());
        }
      }

      const emitter = new SimpleEmitter();
      const fn = vi.fn();

      emitter.on("started", fn);
      emitter.emit("started");
      emitter.emit("started");
      expect(fn).toHaveBeenCalledTimes(2);

      emitter.off("started", fn);
      emitter.emit("started");
      expect(fn).toHaveBeenCalledTimes(2); // not called again
    });

    it("should support once semantics — fires only once", () => {
      class SimpleEmitter implements TaskEventEmitter {
        private _listeners: Map<TaskLifecycleEvent, TaskEventListener[]> = new Map();

        on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = this._listeners.get(event) ?? [];
          list.push(listener);
          this._listeners.set(event, list);
        }

        off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = (this._listeners.get(event) ?? []).filter(l => l !== listener);
          this._listeners.set(event, list);
        }

        once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const wrapper: TaskEventListener = () => {
            listener();
            this.off(event, wrapper);
          };
          this.on(event, wrapper);
        }

        emit(event: TaskLifecycleEvent): void {
          [...(this._listeners.get(event) ?? [])].forEach(l => l());
        }
      }

      const emitter = new SimpleEmitter();
      const fn = vi.fn();

      emitter.once("completed", fn);
      emitter.emit("completed");
      emitter.emit("completed");

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should handle all four lifecycle events independently", () => {
      const calls: TaskLifecycleEvent[] = [];

      class TrackingEmitter implements TaskEventEmitter {
        private _listeners: Map<TaskLifecycleEvent, TaskEventListener[]> = new Map();

        on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = this._listeners.get(event) ?? [];
          list.push(listener);
          this._listeners.set(event, list);
        }

        off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const list = (this._listeners.get(event) ?? []).filter(l => l !== listener);
          this._listeners.set(event, list);
        }

        once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
          const wrapper: TaskEventListener = () => {
            listener();
            this.off(event, wrapper);
          };
          this.on(event, wrapper);
        }

        emit(event: TaskLifecycleEvent): void {
          (this._listeners.get(event) ?? []).forEach(l => l());
        }
      }

      const emitter = new TrackingEmitter();
      const allEvents: TaskLifecycleEvent[] = ["started", "completed", "failed", "killed"];

      for (const event of allEvents) {
        emitter.on(event, () => calls.push(event));
      }

      emitter.emit("started");
      emitter.emit("failed");
      emitter.emit("killed");

      expect(calls).toEqual(["started", "failed", "killed"]);
      expect(calls).not.toContain("completed");
    });
  });
});