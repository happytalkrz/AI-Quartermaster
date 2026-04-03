import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runShell: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { installDependencies } from "../../src/pipeline/dependency-installer.js";
import { runShell } from "../../src/utils/cli-runner.js";

const mockRunShell = vi.mocked(runShell);

describe("installDependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips installation when preInstallCommand is empty string", async () => {
    await installDependencies("", { cwd: "/test/dir" });

    expect(mockRunShell).not.toHaveBeenCalled();
  });

  it("runs installation when preInstallCommand is whitespace only", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "Dependencies installed",
      stderr: "",
      exitCode: 0,
    });

    await installDependencies("   ", { cwd: "/test/dir" });

    expect(mockRunShell).toHaveBeenCalledWith("   ", {
      cwd: "/test/dir",
      timeout: 120000,
    });
  });

  it("successfully installs dependencies when command succeeds", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "Dependencies installed",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      installDependencies("npm install", { cwd: "/test/dir" })
    ).resolves.toBeUndefined();

    expect(mockRunShell).toHaveBeenCalledWith("npm install", {
      cwd: "/test/dir",
      timeout: 120000,
    });
  });

  it("uses custom timeout when provided", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "Dependencies installed",
      stderr: "",
      exitCode: 0,
    });

    await installDependencies("npm install", {
      cwd: "/test/dir",
      timeout: 60000
    });

    expect(mockRunShell).toHaveBeenCalledWith("npm install", {
      cwd: "/test/dir",
      timeout: 60000,
    });
  });

  it("throws error when installation fails", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "npm ERR! peer dep missing",
      stderr: "Installation failed",
      exitCode: 1,
    });

    await expect(
      installDependencies("npm install", { cwd: "/test/dir" })
    ).rejects.toThrow("Dependency installation failed:\nInstallation failed\nnpm ERR! peer dep missing");

    expect(mockRunShell).toHaveBeenCalledWith("npm install", {
      cwd: "/test/dir",
      timeout: 120000,
    });
  });

  it("throws error when command has non-zero exit code", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "",
      stderr: "Command not found",
      exitCode: 127,
    });

    await expect(
      installDependencies("invalid-command", { cwd: "/test/dir" })
    ).rejects.toThrow("Dependency installation failed:\nCommand not found\n");
  });

  it("handles complex installation commands", async () => {
    mockRunShell.mockResolvedValue({
      stdout: "yarn install v1.22.0\nSuccess",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      installDependencies("yarn install --frozen-lockfile", {
        cwd: "/test/project",
        timeout: 180000
      })
    ).resolves.toBeUndefined();

    expect(mockRunShell).toHaveBeenCalledWith("yarn install --frozen-lockfile", {
      cwd: "/test/project",
      timeout: 180000,
    });
  });
});