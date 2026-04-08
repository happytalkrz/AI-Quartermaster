import type { Phase } from "../types/pipeline.js";

/**
 * Represents a group of phases that can be executed in parallel
 */
export interface PhaseGroup {
  level: number;
  phases: Phase[];
}

/**
 * Result of scheduling phases with dependency resolution
 */
export interface ScheduleResult {
  success: boolean;
  groups: PhaseGroup[];
  error?: string;
  circularDependency?: number[];
}

/**
 * Detects circular dependencies in the phase dependency graph
 * Returns the cycle path if found, or empty array if no cycles exist
 */
export function detectCircularDependencies(phases: Phase[]): number[] {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  const phaseMap = new Map<number, Phase>();

  // Build phase index map
  for (const phase of phases) {
    phaseMap.set(phase.index, phase);
  }

  function hasCycle(phaseIndex: number, path: number[]): number[] {
    if (recursionStack.has(phaseIndex)) {
      // Found cycle - return the cycle path
      const cycleStart = path.indexOf(phaseIndex);
      return cycleStart >= 0 ? path.slice(cycleStart).concat(phaseIndex) : [phaseIndex];
    }

    if (visited.has(phaseIndex)) {
      return [];
    }

    visited.add(phaseIndex);
    recursionStack.add(phaseIndex);

    const phase = phaseMap.get(phaseIndex);
    if (phase?.dependsOn) {
      for (const depIndex of phase.dependsOn) {
        const cyclePath = hasCycle(depIndex, [...path, phaseIndex]);
        if (cyclePath.length > 0) {
          return cyclePath;
        }
      }
    }

    recursionStack.delete(phaseIndex);
    return [];
  }

  // Check each phase for cycles
  for (const phase of phases) {
    if (!visited.has(phase.index)) {
      const cyclePath = hasCycle(phase.index, []);
      if (cyclePath.length > 0) {
        return cyclePath;
      }
    }
  }

  return [];
}

/**
 * Detects file conflicts between phases by checking for overlapping targetFiles
 * Returns conflicting phase indices grouped by file path
 */
export function detectFileConflicts(phases: Phase[]): Map<string, number[]> {
  const fileToPhases = new Map<string, number[]>();

  // Group phases by each target file they modify
  for (const phase of phases) {
    for (const file of phase.targetFiles) {
      if (!fileToPhases.has(file)) {
        fileToPhases.set(file, []);
      }
      fileToPhases.get(file)!.push(phase.index);
    }
  }

  // Filter to only return files that have conflicts (>1 phase)
  const conflicts = new Map<string, number[]>();
  for (const [file, phaseIndices] of fileToPhases) {
    if (phaseIndices.length > 1) {
      conflicts.set(file, phaseIndices);
    }
  }

  return conflicts;
}

/**
 * Performs topological sorting of phases based on their dependencies
 * Returns phases grouped by execution level for parallel execution
 * File conflicts are resolved by forcing conflicting phases into serial execution
 */
export function schedulePhases(phases: Phase[], enableParallelPhases: boolean = true): ScheduleResult {
  if (phases.length === 0) {
    return { success: true, groups: [] };
  }

  // Check for circular dependencies first
  const cycle = detectCircularDependencies(phases);
  if (cycle.length > 0) {
    return {
      success: false,
      groups: [],
      error: `Circular dependency detected in phases: ${cycle.join(' → ')}`,
      circularDependency: cycle,
    };
  }

  const phaseMap = new Map<number, Phase>();
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, number[]>();

  // Initialize maps
  for (const phase of phases) {
    phaseMap.set(phase.index, phase);
    inDegree.set(phase.index, 0);
    dependents.set(phase.index, []);
  }

  // Build dependency graph and calculate in-degrees
  for (const phase of phases) {
    if (phase.dependsOn) {
      for (const depIndex of phase.dependsOn) {
        // Validate dependency exists
        if (!phaseMap.has(depIndex)) {
          return {
            success: false,
            groups: [],
            error: `Phase ${phase.index} depends on non-existent phase ${depIndex}`,
          };
        }

        // Increment in-degree for dependent phase
        inDegree.set(phase.index, (inDegree.get(phase.index) || 0) + 1);

        // Add to dependents list
        const deps = dependents.get(depIndex) || [];
        deps.push(phase.index);
        dependents.set(depIndex, deps);
      }
    }
  }

  // Handle file conflicts if parallel phases are enabled
  if (enableParallelPhases) {
    const fileConflicts = detectFileConflicts(phases);

    if (fileConflicts.size > 0) {
      // Add serial dependencies for conflicting phases
      for (const [, conflictingPhases] of fileConflicts) {
        // Sort conflicting phases by index to ensure consistent ordering
        conflictingPhases.sort((a, b) => a - b);

        // Create serial chain: each phase depends on the previous one
        for (let i = 1; i < conflictingPhases.length; i++) {
          const currentPhaseIndex = conflictingPhases[i];
          const previousPhaseIndex = conflictingPhases[i - 1];

          // Add dependency: current phase depends on previous phase
          const currentInDegree = inDegree.get(currentPhaseIndex) || 0;
          inDegree.set(currentPhaseIndex, currentInDegree + 1);

          // Add to dependents list of previous phase
          const deps = dependents.get(previousPhaseIndex) || [];
          if (!deps.includes(currentPhaseIndex)) {
            deps.push(currentPhaseIndex);
            dependents.set(previousPhaseIndex, deps);
          }
        }
      }
    }
  }

  // Kahn's algorithm for topological sorting
  const groups: PhaseGroup[] = [];
  let level = 0;
  const queue: number[] = [];
  const processed = new Set<number>();

  // Find all phases with no dependencies (in-degree = 0)
  for (const [phaseIndex, degree] of inDegree) {
    if (degree === 0) {
      queue.push(phaseIndex);
    }
  }

  while (queue.length > 0) {
    // All phases in current queue can be executed in parallel
    const currentLevelPhases: Phase[] = [];
    const currentQueue = [...queue];
    queue.length = 0; // Clear queue

    for (const phaseIndex of currentQueue) {
      if (processed.has(phaseIndex)) continue;

      const phase = phaseMap.get(phaseIndex);
      if (phase) {
        currentLevelPhases.push(phase);
        processed.add(phaseIndex);

        // Update in-degrees of dependent phases
        const deps = dependents.get(phaseIndex) || [];
        for (const depPhaseIndex of deps) {
          const newInDegree = (inDegree.get(depPhaseIndex) || 0) - 1;
          inDegree.set(depPhaseIndex, newInDegree);

          // If dependency satisfied, add to next level queue
          if (newInDegree === 0 && !processed.has(depPhaseIndex)) {
            queue.push(depPhaseIndex);
          }
        }
      }
    }

    if (currentLevelPhases.length > 0) {
      // Sort phases within level by index for consistent ordering
      currentLevelPhases.sort((a, b) => a.index - b.index);

      groups.push({
        level,
        phases: currentLevelPhases,
      });
      level++;
    }
  }

  // Check if all phases were processed
  if (processed.size !== phases.length) {
    const unprocessed = phases.filter(p => !processed.has(p.index)).map(p => p.index);
    return {
      success: false,
      groups: [],
      error: `Failed to schedule phases. Unprocessed phases: ${unprocessed.join(', ')} (possible circular dependency)`,
    };
  }

  return { success: true, groups };
}

/**
 * Gets the next executable phases that have all dependencies satisfied
 * Based on the list of already completed phase indices
 */
export function getExecutablePhases(phases: Phase[], completedPhases: number[]): Phase[] {
  const completedSet = new Set(completedPhases);
  const executable: Phase[] = [];

  for (const phase of phases) {
    // Skip if already completed
    if (completedSet.has(phase.index)) {
      continue;
    }

    // Check if all dependencies are satisfied
    if (!phase.dependsOn || phase.dependsOn.length === 0) {
      executable.push(phase);
      continue;
    }

    const dependenciesMet = phase.dependsOn.every(depIndex => completedSet.has(depIndex));
    if (dependenciesMet) {
      executable.push(phase);
    }
  }

  // Sort by index for consistent ordering
  return executable.sort((a, b) => a.index - b.index);
}

/**
 * Validates phase dependencies for common issues
 */
export function validatePhaseDependencies(phases: Phase[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const phaseIndices = new Set(phases.map(p => p.index));

  // Check for duplicate phase indices
  const seen = new Set<number>();
  for (const phase of phases) {
    if (seen.has(phase.index)) {
      errors.push(`Duplicate phase index: ${phase.index}`);
    }
    seen.add(phase.index);
  }

  // Check for self-dependencies and non-existent dependencies
  for (const phase of phases) {
    if (phase.dependsOn) {
      for (const depIndex of phase.dependsOn) {
        if (depIndex === phase.index) {
          errors.push(`Phase ${phase.index} cannot depend on itself`);
        }
        if (!phaseIndices.has(depIndex)) {
          errors.push(`Phase ${phase.index} depends on non-existent phase ${depIndex}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}