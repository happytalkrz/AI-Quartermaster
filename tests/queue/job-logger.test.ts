import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobLogger } from "../../src/queue/job-logger.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { Job } from "../../src/queue/job-store.js";

describe("JobLogger", () => {
  let mockJobStore: JobStore;
  let jobLogger: JobLogger;
  const jobId = "test-job-123";

  beforeEach(() => {
    vi.clearAllMocks();

    mockJobStore = {
      get: vi.fn(),
      update: vi.fn(),
    } as any;

    jobLogger = new JobLogger(mockJobStore, jobId);
  });

  describe("log", () => {
    it("should append log message with timestamp", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
        logs: ["Previous log"],
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      jobLogger.log("Test message");

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        logs: [
          "Previous log",
          expect.stringMatching(/\[\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}시 \d{1,2}분 \d{1,2}초\] Test message/),
        ],
        lastUpdatedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/),
      });
    });

    it("should create logs array if it doesn't exist", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      jobLogger.log("First message");

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        logs: [
          expect.stringMatching(/\[\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}시 \d{1,2}분 \d{1,2}초\] First message/),
        ],
        lastUpdatedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/),
      });
    });

    it("should handle undefined logs gracefully", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
        logs: undefined,
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      jobLogger.log("Test message");

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        logs: [
          expect.stringMatching(/\[\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}시 \d{1,2}분 \d{1,2}초\] Test message/),
        ],
        lastUpdatedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/),
      });
    });

    it("should not update if job doesn't exist", () => {
      mockJobStore.get = vi.fn().mockReturnValue(null);

      jobLogger.log("Test message");

      expect(mockJobStore.update).not.toHaveBeenCalled();
    });

    it("should use Korean timezone formatting", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
        logs: [],
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      // Mock Date to control timestamp
      const mockDate = new Date("2026-04-04T03:30:15.123Z");
      vi.spyOn(global, "Date").mockImplementation(() => mockDate as any);

      jobLogger.log("Timezone test");

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        logs: [
          expect.stringContaining("2026. 4. 4. 12시 30분 15초] Timezone test"), // Korean format
        ],
        lastUpdatedAt: expect.any(String),
      });

      vi.restoreAllMocks();
    });
  });

  describe("setStep", () => {
    it("should update currentStep and log the step", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
        logs: [],
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      jobLogger.setStep("Installing dependencies");

      expect(mockJobStore.update).toHaveBeenCalledTimes(2);

      // First call: update currentStep
      expect(mockJobStore.update).toHaveBeenNthCalledWith(1, jobId, {
        currentStep: "Installing dependencies",
      });

      // Second call: log the step
      expect(mockJobStore.update).toHaveBeenNthCalledWith(2, jobId, {
        logs: [
          expect.stringMatching(/\[\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}시 \d{1,2}분 \d{1,2}초\] Installing dependencies/),
        ],
        lastUpdatedAt: expect.any(String),
      });
    });
  });

  describe("setPhaseResults", () => {
    it("should update phaseResults", () => {
      const phaseResults = [
        {
          phaseIndex: 1,
          phaseName: "Setup",
          status: "success" as const,
          filesModified: ["src/index.ts"],
          duration: 1500,
          completedAt: "2026-04-04T10:00:00Z",
        },
      ];

      jobLogger.setPhaseResults(phaseResults);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        phaseResults,
      });
    });

    it("should handle empty phaseResults", () => {
      jobLogger.setPhaseResults([]);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        phaseResults: [],
      });
    });

    it("should handle undefined phaseResults", () => {
      jobLogger.setPhaseResults(undefined);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        phaseResults: undefined,
      });
    });
  });

  describe("setProgress", () => {
    it("should update progress and round to integer", () => {
      jobLogger.setProgress(75.6);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        progress: 76,
      });
    });

    it("should handle zero progress", () => {
      jobLogger.setProgress(0);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        progress: 0,
      });
    });

    it("should handle 100 progress", () => {
      jobLogger.setProgress(100);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        progress: 100,
      });
    });

    it("should round negative progress", () => {
      jobLogger.setProgress(-5.2);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        progress: -5,
      });
    });

    it("should round decimal progress", () => {
      jobLogger.setProgress(33.7);

      expect(mockJobStore.update).toHaveBeenCalledWith(jobId, {
        progress: 34,
      });
    });
  });

  describe("integration", () => {
    it("should work with multiple operations in sequence", () => {
      const mockJob: Job = {
        id: jobId,
        issueNumber: 42,
        repo: "test/repo",
        status: "running",
        createdAt: "2026-04-04T00:00:00Z",
        logs: ["Initial log"],
      };

      mockJobStore.get = vi.fn().mockReturnValue(mockJob);

      // Perform multiple operations
      jobLogger.setStep("Phase 1: Analysis");
      jobLogger.setProgress(25);
      jobLogger.log("Analysis completed");
      jobLogger.setProgress(50);

      expect(mockJobStore.update).toHaveBeenCalledTimes(5);

      // Verify the sequence of calls
      const calls = (mockJobStore.update as any).mock.calls;
      expect(calls[0][1]).toEqual({ currentStep: "Phase 1: Analysis" });
      expect(calls[1][1]).toMatchObject({ logs: expect.any(Array) }); // setStep log
      expect(calls[2][1]).toEqual({ progress: 25 });
      expect(calls[3][1]).toMatchObject({ logs: expect.any(Array) }); // manual log
      expect(calls[4][1]).toEqual({ progress: 50 });
    });

    it("should handle job not found gracefully across all methods", () => {
      mockJobStore.get = vi.fn().mockReturnValue(null);

      jobLogger.log("Should not update");
      jobLogger.setStep("Should not update");
      jobLogger.setProgress(50);
      jobLogger.setPhaseResults([]);

      // Only setStep, setProgress, setPhaseResults should be called (they don't check job existence)
      expect(mockJobStore.update).toHaveBeenCalledTimes(3);
    });
  });
});