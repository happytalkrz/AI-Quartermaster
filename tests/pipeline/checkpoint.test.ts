import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";

// Mock fs module
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  saveCheckpoint,
  loadCheckpoint,
  removeCheckpoint,
  type PipelineCheckpoint
} from "../../src/pipeline/errors/checkpoint.js";
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "fs";

const mockWriteFileSync = vi.mocked(writeFileSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockRenameSync = vi.mocked(renameSync);

function makeCheckpoint(overrides: Partial<PipelineCheckpoint> = {}): PipelineCheckpoint {
  return {
    issueNumber: 42,
    repo: "test/repo",
    state: "planning",
    projectRoot: "/tmp/project",
    phaseResults: [],
    mode: "auto",
    savedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveCheckpoint", () => {
    it("should create checkpoint directory if it doesn't exist", () => {
      const checkpoint = makeCheckpoint();
      const dataDir = "/tmp/data";

      saveCheckpoint(dataDir, 42, checkpoint);

      expect(mockMkdirSync).toHaveBeenCalledWith(
        resolve(dataDir, "checkpoints"),
        { recursive: true }
      );
    });

    it("should save checkpoint to correct file path with atomic write", () => {
      const checkpoint = makeCheckpoint();
      const dataDir = "/tmp/data";

      saveCheckpoint(dataDir, 42, checkpoint);

      const expectedPath = resolve(dataDir, "checkpoints", "42.json");
      const tmpPath = expectedPath + ".tmp";

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        tmpPath,
        JSON.stringify(checkpoint, null, 2)
      );
      expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, expectedPath);
    });

    it("should serialize checkpoint with proper formatting", () => {
      const checkpoint = makeCheckpoint({
        jobId: "job-123",
        worktreePath: "/tmp/worktree",
        branchName: "feature-branch",
      });
      const dataDir = "/tmp/data";

      saveCheckpoint(dataDir, 42, checkpoint);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(checkpoint, null, 2)
      );
    });
  });

  describe("loadCheckpoint", () => {
    it("should return null when checkpoint file doesn't exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = loadCheckpoint("/tmp/data", 42);

      expect(result).toBeNull();
      expect(mockExistsSync).toHaveBeenCalledWith(
        resolve("/tmp/data", "checkpoints", "42.json")
      );
    });

    it("should load and parse checkpoint when file exists", () => {
      const checkpoint = makeCheckpoint();
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(checkpoint));

      const result = loadCheckpoint("/tmp/data", 42);

      expect(result).toEqual(checkpoint);
      expect(mockReadFileSync).toHaveBeenCalledWith(
        resolve("/tmp/data", "checkpoints", "42.json"),
        "utf-8"
      );
    });

    it("should return null and log warning on JSON parse error", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("invalid json");

      const result = loadCheckpoint("/tmp/data", 42);

      expect(result).toBeNull();
      // Note: We can't easily test the logger warning without more complex mocking
    });

    it("should handle file read errors gracefully", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("File read error");
      });

      const result = loadCheckpoint("/tmp/data", 42);

      expect(result).toBeNull();
    });
  });

  describe("removeCheckpoint", () => {
    it("should remove checkpoint file when it exists", () => {
      mockExistsSync.mockReturnValue(true);

      removeCheckpoint("/tmp/data", 42);

      const expectedPath = resolve("/tmp/data", "checkpoints", "42.json");
      expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
      expect(mockUnlinkSync).toHaveBeenCalledWith(expectedPath);
    });

    it("should not attempt to remove file when it doesn't exist", () => {
      mockExistsSync.mockReturnValue(false);

      removeCheckpoint("/tmp/data", 42);

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });
});