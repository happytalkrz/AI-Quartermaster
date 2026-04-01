import { describe, it, expect } from "vitest";
import {
  schedulePhases,
  detectCircularDependencies,
  getExecutablePhases,
  validatePhaseDependencies,
} from "../../src/pipeline/phase-scheduler.js";
import type { Phase } from "../../src/types/pipeline.js";

describe("phase-scheduler", () => {
  const createPhase = (index: number, name: string, dependsOn?: number[]): Phase => ({
    index,
    name,
    description: `Phase ${index}: ${name}`,
    targetFiles: [`file${index}.ts`],
    commitStrategy: "single",
    verificationCriteria: [`verify ${index}`],
    dependsOn,
  });

  describe("schedulePhases", () => {
    it("should handle empty phase list", () => {
      const result = schedulePhases([]);
      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(0);
    });

    it("should schedule phases with no dependencies", () => {
      const phases = [
        createPhase(0, "Init"),
        createPhase(1, "Setup"),
        createPhase(2, "Config"),
      ];

      const result = schedulePhases(phases);
      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].level).toBe(0);
      expect(result.groups[0].phases).toHaveLength(3);
      expect(result.groups[0].phases.map(p => p.index)).toEqual([0, 1, 2]);
    });

    it("should schedule phases with linear dependencies", () => {
      const phases = [
        createPhase(0, "Init"),
        createPhase(1, "Build", [0]),
        createPhase(2, "Test", [1]),
        createPhase(3, "Deploy", [2]),
      ];

      const result = schedulePhases(phases);
      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(4);

      expect(result.groups[0].level).toBe(0);
      expect(result.groups[0].phases.map(p => p.index)).toEqual([0]);

      expect(result.groups[1].level).toBe(1);
      expect(result.groups[1].phases.map(p => p.index)).toEqual([1]);

      expect(result.groups[2].level).toBe(2);
      expect(result.groups[2].phases.map(p => p.index)).toEqual([2]);

      expect(result.groups[3].level).toBe(3);
      expect(result.groups[3].phases.map(p => p.index)).toEqual([3]);
    });

    it("should schedule phases with parallel possibilities", () => {
      const phases = [
        createPhase(0, "Init"),
        createPhase(1, "Frontend", [0]),
        createPhase(2, "Backend", [0]),
        createPhase(3, "Database", [0]),
        createPhase(4, "Integration", [1, 2, 3]),
      ];

      const result = schedulePhases(phases);
      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(3);

      expect(result.groups[0].level).toBe(0);
      expect(result.groups[0].phases.map(p => p.index)).toEqual([0]);

      expect(result.groups[1].level).toBe(1);
      expect(result.groups[1].phases.map(p => p.index)).toEqual([1, 2, 3]);

      expect(result.groups[2].level).toBe(2);
      expect(result.groups[2].phases.map(p => p.index)).toEqual([4]);
    });

    it("should detect circular dependencies", () => {
      const phases = [
        createPhase(0, "A", [2]),
        createPhase(1, "B", [0]),
        createPhase(2, "C", [1]),
      ];

      const result = schedulePhases(phases);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Circular dependency detected");
      expect(result.circularDependency).toBeDefined();
      expect(result.circularDependency!.length).toBeGreaterThan(0);
    });

    it("should handle missing dependency", () => {
      const phases = [
        createPhase(0, "A"),
        createPhase(1, "B", [0, 99]), // 99 doesn't exist
      ];

      const result = schedulePhases(phases);
      expect(result.success).toBe(false);
      expect(result.error).toContain("depends on non-existent phase 99");
    });
  });

  describe("detectCircularDependencies", () => {
    it("should return empty array for no cycles", () => {
      const phases = [
        createPhase(0, "A"),
        createPhase(1, "B", [0]),
        createPhase(2, "C", [1]),
      ];

      const cycle = detectCircularDependencies(phases);
      expect(cycle).toHaveLength(0);
    });

    it("should detect simple cycle", () => {
      const phases = [
        createPhase(0, "A", [1]),
        createPhase(1, "B", [0]),
      ];

      const cycle = detectCircularDependencies(phases);
      expect(cycle.length).toBeGreaterThan(0);
      expect(cycle).toContain(0);
      expect(cycle).toContain(1);
    });

    it("should detect complex cycle", () => {
      const phases = [
        createPhase(0, "A", [2]),
        createPhase(1, "B", [0]),
        createPhase(2, "C", [1]),
        createPhase(3, "D", [0]), // No cycle
      ];

      const cycle = detectCircularDependencies(phases);
      expect(cycle.length).toBeGreaterThan(0);
      expect(cycle).toContain(0);
      expect(cycle).toContain(1);
      expect(cycle).toContain(2);
    });

    it("should detect self-dependency", () => {
      const phases = [
        createPhase(0, "A", [0]), // Self dependency
      ];

      const cycle = detectCircularDependencies(phases);
      expect(cycle.length).toBeGreaterThan(0);
      expect(cycle).toContain(0);
    });
  });

  describe("getExecutablePhases", () => {
    const phases = [
      createPhase(0, "Init"),
      createPhase(1, "Build", [0]),
      createPhase(2, "Test", [1]),
      createPhase(3, "Deploy", [2]),
      createPhase(4, "Config", [0]),
      createPhase(5, "Monitor", [3, 4]),
    ];

    it("should return phases with no dependencies initially", () => {
      const executable = getExecutablePhases(phases, []);
      expect(executable.map(p => p.index)).toEqual([0]);
    });

    it("should return next executable phases after completion", () => {
      const executable = getExecutablePhases(phases, [0]);
      expect(executable.map(p => p.index)).toEqual([1, 4]);
    });

    it("should handle multiple completions", () => {
      const executable = getExecutablePhases(phases, [0, 1, 4]);
      expect(executable.map(p => p.index)).toEqual([2]);
    });

    it("should return phases when all dependencies met", () => {
      const executable = getExecutablePhases(phases, [0, 1, 2, 4]);
      expect(executable.map(p => p.index)).toEqual([3]);
    });

    it("should return final phase when all its dependencies are met", () => {
      const executable = getExecutablePhases(phases, [0, 1, 2, 3, 4]);
      expect(executable.map(p => p.index)).toEqual([5]);
    });

    it("should return empty when all phases completed", () => {
      const executable = getExecutablePhases(phases, [0, 1, 2, 3, 4, 5]);
      expect(executable).toHaveLength(0);
    });

    it("should handle out-of-order completions", () => {
      const executable = getExecutablePhases(phases, [4, 0, 2, 1]);
      expect(executable.map(p => p.index)).toEqual([3]);
    });
  });

  describe("validatePhaseDependencies", () => {
    it("should validate correct dependencies", () => {
      const phases = [
        createPhase(0, "A"),
        createPhase(1, "B", [0]),
        createPhase(2, "C", [1]),
      ];

      const result = validatePhaseDependencies(phases);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect duplicate phase indices", () => {
      const phases = [
        createPhase(0, "A"),
        createPhase(0, "B"), // Duplicate index
      ];

      const result = validatePhaseDependencies(phases);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Duplicate phase index: 0");
    });

    it("should detect self-dependencies", () => {
      const phases = [
        createPhase(0, "A", [0]), // Self dependency
      ];

      const result = validatePhaseDependencies(phases);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Phase 0 cannot depend on itself");
    });

    it("should detect non-existent dependencies", () => {
      const phases = [
        createPhase(0, "A"),
        createPhase(1, "B", [0, 99]), // 99 doesn't exist
      ];

      const result = validatePhaseDependencies(phases);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Phase 1 depends on non-existent phase 99");
    });

    it("should detect multiple errors", () => {
      const phases = [
        createPhase(0, "A", [0]), // Self dependency
        createPhase(0, "B"), // Duplicate index
        createPhase(1, "C", [99]), // Non-existent dependency
      ];

      const result = validatePhaseDependencies(phases);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});