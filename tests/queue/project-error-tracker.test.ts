import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectErrorTracker } from "../../src/queue/project-error-tracker.js";
import type { ConfigProvider } from "../../src/config/config-provider.js";
import type { AQConfig } from "../../src/types/config.js";

function makeConfigProvider(config: Partial<AQConfig> = {}): ConfigProvider {
  return {
    current: () => config as AQConfig,
    refresh: () => {},
  };
}

describe("ProjectErrorTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isProjectPaused / pauseProject / resumeProject", () => {
    it("초기 상태는 paused가 아니다", () => {
      const tracker = new ProjectErrorTracker();
      expect(tracker.isProjectPaused("a/b")).toBe(false);
    });

    it("pauseProject 후 isProjectPaused는 true", () => {
      const tracker = new ProjectErrorTracker();
      tracker.pauseProject("a/b", 60_000);
      expect(tracker.isProjectPaused("a/b")).toBe(true);
    });

    it("pause 만료 시 자동 재개", () => {
      const tracker = new ProjectErrorTracker();
      tracker.pauseProject("a/b", 1000);
      vi.setSystemTime(new Date("2026-04-26T00:00:02.000Z"));
      expect(tracker.isProjectPaused("a/b")).toBe(false);
    });

    it("resumeProject는 pause를 해제", () => {
      const tracker = new ProjectErrorTracker();
      tracker.pauseProject("a/b", 60_000);
      tracker.resumeProject("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(false);
    });
  });

  describe("trackFailure", () => {
    it("기본 임계값 3회 도달 시 자동 pause", () => {
      const tracker = new ProjectErrorTracker();
      tracker.trackFailure("a/b");
      tracker.trackFailure("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(false);
      tracker.trackFailure("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(true);
    });

    it("config의 pauseThreshold가 우선", () => {
      const provider = makeConfigProvider({
        projects: [{ repo: "a/b", pauseThreshold: 1, pauseDurationMs: 60_000 } as never],
      });
      const tracker = new ProjectErrorTracker(provider);
      tracker.trackFailure("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(true);
    });

    it("configProvider 없이도 기본값으로 동작", () => {
      const tracker = new ProjectErrorTracker();
      tracker.trackFailure("a/b");
      const status = tracker.getProjectStatus("a/b");
      expect(status?.consecutiveFailures).toBe(1);
    });

    it("config.current() throw 시 기본값 fallback", () => {
      const provider: ConfigProvider = {
        current: () => {
          throw new Error("config broken");
        },
        refresh: () => {},
      };
      const tracker = new ProjectErrorTracker(provider);
      tracker.trackFailure("a/b");
      const status = tracker.getProjectStatus("a/b");
      expect(status?.consecutiveFailures).toBe(1);
    });
  });

  describe("trackSuccess", () => {
    it("연속 실패 카운터를 0으로 리셋", () => {
      const tracker = new ProjectErrorTracker();
      tracker.trackFailure("a/b");
      tracker.trackFailure("a/b");
      tracker.trackSuccess("a/b");
      expect(tracker.getProjectStatus("a/b")?.consecutiveFailures).toBe(0);
    });

    it("수동 pausedUntil은 trackSuccess가 유지", () => {
      const tracker = new ProjectErrorTracker();
      tracker.trackFailure("a/b");
      tracker.pauseProject("a/b", 60_000);
      tracker.trackSuccess("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(true);
    });
  });

  describe("setConfigProvider", () => {
    it("지연 주입 후 trackFailure가 새 provider를 사용", () => {
      const tracker = new ProjectErrorTracker();
      tracker.setConfigProvider(
        makeConfigProvider({
          projects: [{ repo: "a/b", pauseThreshold: 1, pauseDurationMs: 60_000 } as never],
        })
      );
      tracker.trackFailure("a/b");
      expect(tracker.isProjectPaused("a/b")).toBe(true);
    });
  });

  describe("clear", () => {
    it("모든 상태를 비운다", () => {
      const tracker = new ProjectErrorTracker();
      tracker.trackFailure("a/b");
      tracker.pauseProject("c/d", 60_000);
      tracker.clear();
      expect(tracker.getProjectStatus("a/b")).toBeNull();
      expect(tracker.isProjectPaused("c/d")).toBe(false);
    });
  });
});
