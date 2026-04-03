import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runSetup, runInteractiveWizard } from "../../src/setup/setup-wizard.js";
import { MockPrompt } from "../../src/setup/prompt-utils.js";
import type { SetupOptions, WizardAnswers } from "../../src/types/config.js";
import * as cliRunner from "../../src/utils/cli-runner.js";
import * as promptUtils from "../../src/setup/prompt-utils.js";
import * as validators from "../../src/setup/validators.js";
import * as setupWizard from "../../src/setup/setup-wizard.js";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("setup-wizard", () => {
  let testDir: string;
  let aqRoot: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-setup-test-${Date.now()}`);
    aqRoot = join(testDir, "aq");
    mkdirSync(aqRoot, { recursive: true });

    // Mock CLI commands by default
    vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
      if (command === "git" && args.includes("--version")) {
        return { exitCode: 0, stdout: "git version 2.0.0", stderr: "" };
      }
      if (command === "gh" && args.includes("status")) {
        return { exitCode: 0, stdout: "Logged in to github.com", stderr: "" };
      }
      if (command === "claude" && args.includes("--version")) {
        return { exitCode: 0, stdout: "claude version 1.0.0", stderr: "" };
      }
      if (command === "gh" && args.includes("setup-git")) {
        return { exitCode: 0, stdout: "git credential helper configured", stderr: "" };
      }
      if (command === "curl" && args.includes("smee.io/new")) {
        return { exitCode: 0, stdout: "https://smee.io/test-channel", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    // Mock console.log to prevent noise in tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("runSetup", () => {
    describe("non-interactive mode", () => {
      it("should create minimal config.yml when not exists", async () => {
        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        const configPath = join(aqRoot, "config.yml");
        expect(existsSync(configPath)).toBe(true);

        const content = readFileSync(configPath, "utf-8");
        expect(content).toContain("# AI 병참부 최소 설정 파일");
        expect(content).toContain("owner/repo-name");
        expect(content).toContain("/path/to/local/clone");
      });

      it("should skip config.yml creation when already exists", async () => {
        const configPath = join(aqRoot, "config.yml");
        const existingContent = "existing config content";
        writeFileSync(configPath, existingContent);

        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        const content = readFileSync(configPath, "utf-8");
        expect(content).toBe(existingContent);
      });

      it("should create .env file with webhook secret", async () => {
        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        const envPath = join(aqRoot, ".env");
        expect(existsSync(envPath)).toBe(true);

        const content = readFileSync(envPath, "utf-8");
        expect(content).toContain("GITHUB_WEBHOOK_SECRET=");
        expect(content).toContain("SMEE_URL=");
        expect(content).toContain("PORT=3000");
      });

      it("should use .env.example as template when exists", async () => {
        const envExamplePath = join(aqRoot, ".env.example");
        const templateContent = `# Example environment
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here
CUSTOM_VAR=example
`;
        writeFileSync(envExamplePath, templateContent);

        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        const envPath = join(aqRoot, ".env");
        const content = readFileSync(envPath, "utf-8");

        expect(content).toContain("CUSTOM_VAR=example");
        expect(content).not.toContain("your-webhook-secret-here");
        expect(content).toMatch(/GITHUB_WEBHOOK_SECRET=[a-f0-9]{64}/);
      });
    });

    describe("interactive mode", () => {
      it("should prompt for overwrite when config.yml exists", async () => {
        const configPath = join(aqRoot, "config.yml");
        writeFileSync(configPath, "existing content");

        const mockConfirm = vi.spyOn(promptUtils, "askConfirm").mockResolvedValue(false);

        await runSetup(aqRoot, {});

        expect(mockConfirm).toHaveBeenCalledWith("   config.yml이 이미 존재합니다. 덮어쓰시겠습니까?");

        // Should not change existing file when user says no
        const content = readFileSync(configPath, "utf-8");
        expect(content).toBe("existing content");
      });

    });

    describe("prerequisites check", () => {
      it("should exit when git is not available", async () => {
        vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string) => {
          if (command === "git") {
            return { exitCode: 1, stdout: "", stderr: "command not found" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        });

        const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
          throw new Error("process.exit called");
        });

        await expect(runSetup(aqRoot, {})).rejects.toThrow("process.exit called");
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it("should exit when gh is not authenticated", async () => {
        vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
          if (command === "gh" && args.includes("status")) {
            return { exitCode: 1, stdout: "", stderr: "not logged in" };
          }
          if (command === "git" && args.includes("--version")) {
            return { exitCode: 0, stdout: "git version 2.0.0", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        });

        const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
          throw new Error("process.exit called");
        });

        await expect(runSetup(aqRoot, {})).rejects.toThrow("process.exit called");
        expect(mockExit).toHaveBeenCalledWith(1);
      });

      it("should exit when claude CLI is not available", async () => {
        vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
          if (command === "claude") {
            return { exitCode: 1, stdout: "", stderr: "command not found" };
          }
          if (command === "git" && args.includes("--version")) {
            return { exitCode: 0, stdout: "git version 2.0.0", stderr: "" };
          }
          if (command === "gh" && args.includes("status")) {
            return { exitCode: 0, stdout: "Logged in to github.com", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        });

        const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
          throw new Error("process.exit called");
        });

        await expect(runSetup(aqRoot, {})).rejects.toThrow("process.exit called");
        expect(mockExit).toHaveBeenCalledWith(1);
      });
    });

    describe("smee channel creation", () => {
      it("should create new smee channel when not set", async () => {
        vi.clearAllMocks();

        // Override CLI runner mock specifically for this test
        vi.spyOn(cliRunner, "runCli").mockImplementation(async (command: string, args: string[]) => {
          if (command === "git" && args.includes("--version")) {
            return { exitCode: 0, stdout: "git version 2.0.0", stderr: "" };
          }
          if (command === "gh" && args.includes("status")) {
            return { exitCode: 0, stdout: "Logged in to github.com", stderr: "" };
          }
          if (command === "claude" && args.includes("--version")) {
            return { exitCode: 0, stdout: "claude version 1.0.0", stderr: "" };
          }
          if (command === "gh" && args.includes("setup-git")) {
            return { exitCode: 0, stdout: "git credential helper configured", stderr: "" };
          }
          if (command === "curl" && args.some(arg => arg.includes("smee.io/new"))) {
            return { exitCode: 0, stdout: "https://smee.io/new-channel", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        });

        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        const envPath = join(aqRoot, ".env");
        const content = readFileSync(envPath, "utf-8");
        expect(content).toContain("SMEE_URL=https://smee.io/new-channel");
      });

      it("should skip smee creation when URL already exists", async () => {
        const envPath = join(aqRoot, ".env");
        const existingEnv = `GITHUB_WEBHOOK_SECRET=existing
SMEE_URL=https://smee.io/existing-channel
PORT=3000
`;
        writeFileSync(envPath, existingEnv);

        const curlSpy = vi.spyOn(cliRunner, "runCli");

        const options: SetupOptions = { nonInteractive: true };
        await runSetup(aqRoot, options);

        // Should not call curl for smee creation
        expect(curlSpy).not.toHaveBeenCalledWith(
          "curl",
          expect.arrayContaining(["smee.io/new"]),
          expect.any(Object)
        );

        const content = readFileSync(envPath, "utf-8");
        expect(content).toContain("SMEE_URL=https://smee.io/existing-channel");
      });
    });
  });

  describe("runInteractiveWizard", () => {
    let mockPath: string;

    beforeEach(() => {
      mockPath = join(testDir, "mock-repo");
      mkdirSync(mockPath, { recursive: true });
    });

    it("should collect valid answers through complete wizard flow", async () => {
      const mockAskQuestion = vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("test-user/test-repo")  // valid repo
        .mockResolvedValueOnce(mockPath);               // valid path

      const mockAskChoice = vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(0); // polling mode (index 0)

      const result = await runInteractiveWizard();

      expect(result).toEqual({
        repo: "test-user/test-repo",
        path: mockPath,
        serverMode: "polling"
      });

      expect(mockAskQuestion).toHaveBeenCalledTimes(2);
      expect(mockAskChoice).toHaveBeenCalledTimes(1);
    });

    it("should retry on invalid repo format until valid input", async () => {
      const mockAskQuestion = vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("invalid-repo")         // invalid (no slash)
        .mockResolvedValueOnce("user/")               // invalid (empty repo)
        .mockResolvedValueOnce("valid-user/valid-repo") // valid
        .mockResolvedValueOnce(mockPath);             // valid path

      const mockAskChoice = vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(0); // polling mode

      // Mock validation functions
      const validateSpy = vi.spyOn(validators, "validateRepoFormat").mockImplementation((input: string) => {
        if (input === "invalid-repo") {
          return { isValid: false, error: "저장소 형식은 'owner/repo' 형태여야 합니다." };
        }
        if (input === "user/") {
          return { isValid: false, error: "저장소 이름이 비어있습니다." };
        }
        return { isValid: true };
      });
      const handleErrorSpy = vi.spyOn(validators, "handleValidationError").mockImplementation(() => {});

      const result = await runInteractiveWizard();

      expect(result.repo).toBe("valid-user/valid-repo");
      expect(validateSpy).toHaveBeenCalledTimes(3);
      expect(handleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it("should retry on invalid path until valid input", async () => {
      const invalidPath = join(testDir, "non-existent");

      const mockAskQuestion = vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("user/repo")           // valid repo
        .mockResolvedValueOnce(invalidPath)           // invalid path (doesn't exist)
        .mockResolvedValueOnce(mockPath);              // valid path

      const mockAskChoice = vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(1); // webhook mode (index 1)

      vi.spyOn(promptUtils, "askConfirm").mockResolvedValue(true); // Continue after error

      const result = await runInteractiveWizard();

      expect(result.path).toBe(mockPath);
      expect(result.serverMode).toBe("webhook");
    });

    it("should suggest clone when path doesn't exist", async () => {
      const nonExistentPath = join(testDir, "non-existent");

      const mockAskQuestion = vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("user/repo")           // valid repo
        .mockResolvedValueOnce(nonExistentPath)       // invalid path
        .mockResolvedValueOnce(mockPath);             // valid path (after clone suggestion)

      const mockAskChoice = vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(0); // polling mode

      vi.spyOn(promptUtils, "askConfirm").mockResolvedValue(true);

      const suggestCloneSpy = vi.spyOn(validators, "suggestClone").mockResolvedValue({
        isValid: true,
        suggestion: "gh repo clone user/repo"
      });

      const result = await runInteractiveWizard();

      expect(suggestCloneSpy).toHaveBeenCalledWith("user/repo");
      expect(result.path).toBe(mockPath);
    });

    it("should exit when user chooses not to continue after path error", async () => {
      const invalidPath = join(testDir, "non-existent");

      const mockAskQuestion = vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("user/repo")           // valid repo
        .mockResolvedValueOnce(invalidPath);          // invalid path

      vi.spyOn(promptUtils, "askConfirm").mockResolvedValue(false); // Don't continue

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(runInteractiveWizard()).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should handle both server mode choices correctly", async () => {
      // Test polling mode (choice 0)
      vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("user/repo")
        .mockResolvedValueOnce(mockPath);

      vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(0);  // polling mode (index 0)

      const resultCode = await runInteractiveWizard();
      expect(resultCode.serverMode).toBe("polling");

      // Reset mocks for webhook mode test
      vi.clearAllMocks();

      // Test webhook mode (choice 1)
      vi.spyOn(promptUtils, "askQuestion")
        .mockResolvedValueOnce("user/repo")
        .mockResolvedValueOnce(mockPath);

      vi.spyOn(promptUtils, "askChoice")
        .mockResolvedValue(1);  // webhook mode (index 1)

      const resultContent = await runInteractiveWizard();
      expect(resultContent.serverMode).toBe("webhook");
    });
  });
});