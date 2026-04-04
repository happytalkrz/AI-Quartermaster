import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "../../src/hooks/hook-registry.js";
import type { HooksConfig, HookTiming } from "../../src/types/hooks.js";

describe("HookRegistry", () => {
  let registry: HookRegistry;
  let mockHooksConfig: HooksConfig;

  beforeEach(() => {
    mockHooksConfig = {
      "pre-plan": [
        { command: "echo 'Starting plan generation'", timeout: 5000 },
        { command: "npm run lint", timeout: 30000 }
      ],
      "post-plan": [
        { command: "echo 'Plan generation complete'" }
      ],
      "pre-phase": [
        { command: "git status" }
      ],
      "post-phase": [
        { command: "npm test", timeout: 60000 }
      ],
      "pre-review": [
        { command: "echo 'Starting review'" }
      ],
      "post-review": [
        { command: "echo 'Review complete'", timeout: 10000 }
      ]
    };

    registry = new HookRegistry(mockHooksConfig);
  });

  describe("constructor", () => {
    it("should initialize with empty config", () => {
      const emptyRegistry = new HookRegistry({});
      expect(emptyRegistry.getHooks("pre-plan")).toEqual([]);
    });

    it("should initialize with provided config", () => {
      expect(registry.getHooks("pre-plan")).toEqual([
        { command: "echo 'Starting plan generation'", timeout: 5000 },
        { command: "npm run lint", timeout: 30000 }
      ]);
    });

    it("should handle undefined config", () => {
      const undefinedRegistry = new HookRegistry();
      expect(undefinedRegistry.getHooks("pre-plan")).toEqual([]);
    });
  });

  describe("getHooks", () => {
    it("should return hooks for existing timing", () => {
      const hooks = registry.getHooks("pre-plan");
      expect(hooks).toHaveLength(2);
      expect(hooks[0]).toEqual({ command: "echo 'Starting plan generation'", timeout: 5000 });
      expect(hooks[1]).toEqual({ command: "npm run lint", timeout: 30000 });
    });

    it("should return empty array for non-existing timing", () => {
      const hooks = registry.getHooks("pre-pr");
      expect(hooks).toEqual([]);
    });

    it("should return empty array for timing with no hooks", () => {
      const sparseConfig: HooksConfig = {
        "pre-plan": [{ command: "echo test" }]
      };
      const sparseRegistry = new HookRegistry(sparseConfig);

      expect(sparseRegistry.getHooks("post-pr")).toEqual([]);
    });

    it("should validate timing parameter", () => {
      const validTimings: HookTiming[] = [
        "pre-plan", "post-plan", "pre-phase", "post-phase",
        "pre-review", "post-review", "pre-pr", "post-pr"
      ];

      validTimings.forEach(timing => {
        expect(() => registry.getHooks(timing)).not.toThrow();
      });
    });
  });

  describe("hasHooks", () => {
    it("should return true when hooks exist for timing", () => {
      expect(registry.hasHooks("pre-plan")).toBe(true);
      expect(registry.hasHooks("post-plan")).toBe(true);
    });

    it("should return false when no hooks exist for timing", () => {
      expect(registry.hasHooks("pre-pr")).toBe(false);
      expect(registry.hasHooks("post-pr")).toBe(false);
    });

    it("should return false for empty hook arrays", () => {
      const emptyConfig: HooksConfig = {
        "pre-plan": []
      };
      const emptyRegistry = new HookRegistry(emptyConfig);

      expect(emptyRegistry.hasHooks("pre-plan")).toBe(false);
    });
  });

  describe("getAllTimings", () => {
    it("should return all configured timings", () => {
      const timings = registry.getAllTimings();
      expect(timings).toEqual(expect.arrayContaining([
        "pre-plan", "post-plan", "pre-phase", "post-phase", "pre-review", "post-review"
      ]));
      expect(timings).not.toContain("pre-pr");
      expect(timings).not.toContain("post-pr");
    });

    it("should return empty array for empty config", () => {
      const emptyRegistry = new HookRegistry({});
      expect(emptyRegistry.getAllTimings()).toEqual([]);
    });
  });

  describe("updateConfig", () => {
    it("should update hooks configuration", () => {
      const newConfig: HooksConfig = {
        "pre-pr": [{ command: "echo 'Creating PR'", timeout: 15000 }],
        "post-pr": [{ command: "echo 'PR created'" }]
      };

      registry.updateConfig(newConfig);

      expect(registry.getHooks("pre-pr")).toEqual([
        { command: "echo 'Creating PR'", timeout: 15000 }
      ]);
      expect(registry.getHooks("post-pr")).toEqual([
        { command: "echo 'PR created'" }
      ]);

      // Previous hooks should be cleared
      expect(registry.getHooks("pre-plan")).toEqual([]);
    });

    it("should merge with existing config when merge flag is true", () => {
      const additionalConfig: HooksConfig = {
        "pre-pr": [{ command: "echo 'Creating PR'" }],
        "pre-plan": [{ command: "echo 'Override plan'" }] // Should override existing
      };

      registry.updateConfig(additionalConfig, true);

      expect(registry.getHooks("pre-pr")).toEqual([
        { command: "echo 'Creating PR'" }
      ]);
      expect(registry.getHooks("pre-plan")).toEqual([
        { command: "echo 'Override plan'" }
      ]);
      // Other existing hooks should remain
      expect(registry.getHooks("post-plan")).toEqual([
        { command: "echo 'Plan generation complete'" }
      ]);
    });
  });

  describe("getHookCount", () => {
    it("should return total number of hooks across all timings", () => {
      const totalHooks = registry.getHookCount();
      expect(totalHooks).toBe(7); // 2 + 1 + 1 + 1 + 1 + 1 = 7
    });

    it("should return 0 for empty registry", () => {
      const emptyRegistry = new HookRegistry({});
      expect(emptyRegistry.getHookCount()).toBe(0);
    });
  });
});