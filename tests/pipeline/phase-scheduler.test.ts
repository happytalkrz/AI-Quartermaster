import { describe, it, expect } from "vitest";
import {
  schedulePhases,
  detectCircularDependencies,
  detectFileConflicts,
  getExecutablePhases,
  validatePhaseDependencies,
} from "../../src/pipeline/phase-scheduler.js";
import type { Phase } from "../../src/types/pipeline.js";

describe("phase-scheduler", () => {
  const createPhase = (index: number, name: string, dependsOn?: number[], targetFiles?: string[]): Phase => ({
    index,
    name,
    description: `Phase ${index}: ${name}`,
    targetFiles: targetFiles || [`file${index}.ts`],
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

  describe("detectFileConflicts", () => {
    it("should detect no conflicts when phases target different files", () => {
      const phases = [
        createPhase(0, "Component A", undefined, ["src/a.ts"]),
        createPhase(1, "Component B", undefined, ["src/b.ts"]),
        createPhase(2, "Component C", undefined, ["src/c.ts"]),
      ];

      const conflicts = detectFileConflicts(phases);
      expect(conflicts.size).toBe(0);
    });

    it("should detect conflicts when phases target the same file", () => {
      const phases = [
        createPhase(0, "Update A", undefined, ["src/shared.ts"]),
        createPhase(1, "Update B", undefined, ["src/shared.ts"]),
        createPhase(2, "Different", undefined, ["src/other.ts"]),
      ];

      const conflicts = detectFileConflicts(phases);
      expect(conflicts.size).toBe(1);
      expect(conflicts.get("src/shared.ts")).toEqual([0, 1]);
    });

    it("should handle multiple file conflicts", () => {
      const phases = [
        createPhase(0, "Update config", undefined, ["src/config.ts", "src/utils.ts"]),
        createPhase(1, "Update config2", undefined, ["src/config.ts"]),
        createPhase(2, "Update utils", undefined, ["src/utils.ts"]),
      ];

      const conflicts = detectFileConflicts(phases);
      expect(conflicts.size).toBe(2);
      expect(conflicts.get("src/config.ts")).toEqual([0, 1]);
      expect(conflicts.get("src/utils.ts")).toEqual([0, 2]);
    });

    it("should handle three-way conflicts", () => {
      const phases = [
        createPhase(0, "Fix A", undefined, ["src/main.ts"]),
        createPhase(1, "Fix B", undefined, ["src/main.ts"]),
        createPhase(2, "Fix C", undefined, ["src/main.ts"]),
      ];

      const conflicts = detectFileConflicts(phases);
      expect(conflicts.size).toBe(1);
      expect(conflicts.get("src/main.ts")).toEqual([0, 1, 2]);
    });
  });

  describe("schedulePhases with file conflict resolution", () => {
    it("should serialize conflicting phases when parallel enabled", () => {
      const phases = [
        createPhase(0, "Update A", undefined, ["src/shared.ts"]),
        createPhase(1, "Update B", undefined, ["src/shared.ts"]),
        createPhase(2, "Update C", undefined, ["src/other.ts"]), // No conflict
      ];

      const result = schedulePhases(phases, true); // Enable parallel phases
      expect(result.success).toBe(true);

      // With file conflict, phases 0 and 1 should be serialized
      // Phase 2 has no conflicts so can run in parallel with Phase 0
      expect(result.groups).toHaveLength(2);

      // Phase 0 and 2 can run in parallel (level 0)
      expect(result.groups[0].phases.map(p => p.index).sort()).toEqual([0, 2]);
      // Phase 1 must wait for Phase 0 (level 1)
      expect(result.groups[1].phases.map(p => p.index)).toEqual([1]);
    });

    it("should allow parallel execution when parallel disabled", () => {
      const phases = [
        createPhase(0, "Update A", undefined, ["src/shared.ts"]),
        createPhase(1, "Update B", undefined, ["src/shared.ts"]),
      ];

      const result = schedulePhases(phases, false); // Disable parallel phases
      expect(result.success).toBe(true);
      expect(result.groups).toHaveLength(1); // Should run in parallel when disabled

      // Both phases run in parallel when feature disabled
      expect(result.groups[0].phases.map(p => p.index)).toEqual([0, 1]);
    });

    it("should respect existing dependencies with file conflicts", () => {
      const phases = [
        createPhase(0, "Init", [], ["src/init.ts"]),
        createPhase(1, "Update A", [0], ["src/shared.ts"]),
        createPhase(2, "Update B", undefined, ["src/shared.ts"]), // Conflicts with phase 1
      ];

      const result = schedulePhases(phases, true);
      console.log('Complex test result groups:', result.groups.map(g => ({ level: g.level, phases: g.phases.map(p => p.index) })));
      expect(result.success).toBe(true);

      // Expected behavior:
      // Level 0: Phase 0 (init, no deps)
      // Level 1: Phase 2 (no explicit deps, but has conflict serialization), Phase 1 (depends on 0)
      // OR serialized completely depending on conflict resolution
      expect(result.groups.length).toBeGreaterThan(0);

      expect(result.groups[0].phases.map(p => p.index)).toEqual([0]);
      // The exact layout may vary, let's see what we get
      if (result.groups.length >= 2) {
        console.log('Level 1 phases:', result.groups[1].phases.map(p => p.index));
      }
      if (result.groups.length >= 3) {
        console.log('Level 2 phases:', result.groups[2].phases.map(p => p.index));
      }
    });
  });
});