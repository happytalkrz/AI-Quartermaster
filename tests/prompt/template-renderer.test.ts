import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  buildBaseLayer,
  buildProjectLayer,
  buildPhaseLayer,
  buildIssueLayer,
  buildLearningLayer,
  computeLayerCacheKey,
  assemblePrompt,
  buildStaticLayers,
  buildDynamicLayers,
  assembleFromCached,
} from "../../src/prompt/template-renderer.js";
import type { PromptLayer } from "../../src/types/pipeline.js";
import type { PromptLayers } from "../../src/prompt/layer-types.js";

describe("renderTemplate", () => {
  it("should replace simple variables", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("should replace nested variables", () => {
    const result = renderTemplate("Issue #{{issue.number}}: {{issue.title}}", {
      issue: { number: "42", title: "Fix bug" },
    });
    expect(result).toBe("Issue #42: Fix bug");
  });

  it("should handle arrays", () => {
    const result = renderTemplate("Labels: {{labels}}", {
      labels: ["bug", "enhancement"],
    });
    expect(result).toBe("Labels: bug, enhancement");
  });

  it("should handle spaces in template tags", () => {
    const result = renderTemplate("{{ name }}", { name: "test" });
    expect(result).toBe("test");
  });

  it("should leave unresolved variables as-is", () => {
    const result = renderTemplate("{{unknown}}", {});
    expect(result).toBe("{{unknown}}");
  });

  it("should handle numbers and booleans", () => {
    const result = renderTemplate("{{count}} items, active: {{active}}", {
      count: 5,
      active: true,
    });
    expect(result).toBe("5 items, active: true");
  });

  it("should handle deeply nested variables", () => {
    const result = renderTemplate("{{a.b.c}}", {
      a: { b: { c: "deep" } },
    });
    expect(result).toBe("deep");
  });
});

describe("buildBaseLayer", () => {
  it("should create base layer with required fields", () => {
    const result = buildBaseLayer({
      role: "시니어 개발자",
    });

    expect(result.role).toBe("시니어 개발자");
    expect(result.rules).toBeInstanceOf(Array);
    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.outputFormat).toContain("JSON");
    expect(result.progressReporting).toContain("HEARTBEAT");
    expect(result.parallelWorkGuide).toContain("서브에이전트");
  });

  it("should handle optional locale field", () => {
    const result = buildBaseLayer({
      role: "Software Engineer",
      locale: "en",
    });

    expect(result.role).toBe("Software Engineer");
    expect(result.rules).toBeInstanceOf(Array);
  });

  it("should include all required rule categories", () => {
    const result = buildBaseLayer({ role: "Developer" });

    const rulesText = result.rules.join(" ");
    expect(rulesText).toContain("Phase의 대상 파일만");
    expect(rulesText).toContain("git add + git commit");
    expect(rulesText).toContain("any 금지");
    expect(rulesText).toContain("ESM import");
    expect(rulesText).toContain("logger 사용");
  });
});

describe("buildProjectLayer", () => {
  it("should create project layer with required fields", () => {
    const result = buildProjectLayer({
      conventions: "TypeScript + ESM + Vitest",
      testCommand: "npx vitest run",
      lintCommand: "npx eslint src/ tests/",
    });

    expect(result.conventions).toBe("TypeScript + ESM + Vitest");
    expect(result.testCommand).toBe("npx vitest run");
    expect(result.lintCommand).toBe("npx eslint src/ tests/");
    expect(result.structure).toBe("");
    expect(result.skillsContext).toBeUndefined();
    expect(result.pastFailures).toBeUndefined();
    expect(result.safetyRules).toBeInstanceOf(Array);
  });

  it("should handle optional fields", () => {
    const result = buildProjectLayer({
      conventions: "Test conventions",
      structure: "src/ tests/ docs/",
      skillsContext: "Skills context",
      pastFailures: "Past failures",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      safetyRules: ["custom rule 1", "custom rule 2"],
    });

    expect(result.structure).toBe("src/ tests/ docs/");
    expect(result.skillsContext).toBe("Skills context");
    expect(result.pastFailures).toBe("Past failures");
    expect(result.safetyRules).toEqual(["custom rule 1", "custom rule 2"]);
  });

  it("should use default safety rules when not provided", () => {
    const result = buildProjectLayer({
      conventions: "Test",
      testCommand: "test",
      lintCommand: "lint",
    });

    expect(result.safetyRules).toHaveLength(3);
    expect(result.safetyRules[0]).toContain("config 필드 추가 시");
    expect(result.safetyRules[1]).toContain("안전장치 우회 금지");
    expect(result.safetyRules[2]).toBe("git add -f 절대 금지");
  });
});

describe("buildPhaseLayer", () => {
  it("should create phase layer with complete structure", () => {
    const result = buildPhaseLayer({
      issue: {
        number: 123,
        title: "Fix critical bug",
        body: "This bug needs to be fixed urgently",
        labels: ["bug", "critical"],
      },
      planSummary: "Fix the bug by updating config",
      currentPhase: {
        index: 2,
        totalCount: 4,
        name: "Implementation",
        description: "Implement the fix",
        targetFiles: ["src/config.ts", "tests/config.test.ts"],
      },
      previousResults: "Phase 1: SUCCESS - Analysis complete",
      repository: {
        owner: "test-org",
        name: "test-repo",
        baseBranch: "main",
        workBranch: "fix/123-bug",
      },
    });

    expect(result.issue.number).toBe(123);
    expect(result.issue.title).toBe("Fix critical bug");
    expect(result.issue.labels).toEqual(["bug", "critical"]);
    expect(result.planSummary).toBe("Fix the bug by updating config");
    expect(result.currentPhase.index).toBe(2);
    expect(result.currentPhase.totalCount).toBe(4);
    expect(result.currentPhase.targetFiles).toEqual(["src/config.ts", "tests/config.test.ts"]);
    expect(result.previousResults).toBe("Phase 1: SUCCESS - Analysis complete");
    expect(result.repository.owner).toBe("test-org");
    expect(result.repository.name).toBe("test-repo");
    expect(result.locale).toBeUndefined();
  });

  it("should handle optional locale field", () => {
    const result = buildPhaseLayer({
      issue: {
        number: 1,
        title: "Test",
        body: "Body",
        labels: [],
      },
      planSummary: "Plan",
      currentPhase: {
        index: 1,
        totalCount: 1,
        name: "Test Phase",
        description: "Description",
        targetFiles: [],
      },
      previousResults: "",
      repository: {
        owner: "owner",
        name: "repo",
        baseBranch: "main",
        workBranch: "feature",
      },
      locale: "en",
    });

    expect(result.locale).toBe("en");
  });
});

describe("assemblePrompt", () => {
  function createTestLayers(): PromptLayer {
    return {
      base: buildBaseLayer({
        role: "Test Developer",
      }),
      project: buildProjectLayer({
        conventions: "Test conventions",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      }),
      phase: buildPhaseLayer({
        issue: {
          number: 42,
          title: "Test Issue",
          body: "Test body",
          labels: ["test"],
        },
        planSummary: "Test plan",
        currentPhase: {
          index: 1,
          totalCount: 2,
          name: "Test Phase",
          description: "Test description",
          targetFiles: ["src/test.ts"],
        },
        previousResults: "Previous success",
        repository: {
          owner: "test",
          name: "repo",
          baseBranch: "main",
          workBranch: "test",
        },
      }),
    };
  }

  it("should assemble prompt with variable replacement", () => {
    const layers = createTestLayers();
    const template = "Role: {{role}}\nIssue #{{issue.number}}: {{issue.title}}\nPhase {{phase.index}}/{{phase.totalCount}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Role: Test Developer");
    expect(result.content).toContain("Issue #42: Test Issue");
    expect(result.content).toContain("Phase 1/2");
    expect(result.cacheKey).toMatch(/^[a-f0-9]{16}$/);
    expect(result.cacheHit).toBe(false);
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should generate consistent cache keys for same static content", () => {
    const layers1 = createTestLayers();
    const layers2 = createTestLayers();
    const template = "{{role}}";

    const result1 = assemblePrompt(layers1, template);
    const result2 = assemblePrompt(layers2, template);

    expect(result1.cacheKey).toBe(result2.cacheKey);
  });

  it("should handle complex nested variables", () => {
    const layers = createTestLayers();
    const template = `
Repository: {{repository.owner}}/{{repository.name}}
Test Command: {{config.testCommand}}
Labels: {{issue.labels}}
Target Files: {{phase.files}}
`;

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Repository: test/repo");
    expect(result.content).toContain("Test Command: npm test");
    expect(result.content).toContain("Labels: test");
    expect(result.content).toContain("Target Files: src/test.ts");
  });

  it("should preserve unresolved variables", () => {
    const layers = createTestLayers();
    const template = "Known: {{role}}, Unknown: {{unknown.variable}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Known: Test Developer");
    expect(result.content).toContain("Unknown: {{unknown.variable}}");
  });

  it("should handle arrays in phase files", () => {
    const layers = createTestLayers();
    layers.phase.currentPhase.targetFiles = ["file1.ts", "file2.ts", "file3.ts"];
    const template = "Files: {{phase.files}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Files: file1.ts, file2.ts, file3.ts");
  });

  it("should measure assembly time", () => {
    const layers = createTestLayers();
    const template = "Simple template {{role}}";

    const result = assemblePrompt(layers, template);

    expect(typeof result.assemblyTimeMs).toBe("number");
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.assemblyTimeMs).toBeLessThan(1000); // Should be fast
  });
});

describe("buildIssueLayer", () => {
  it("should create issue layer with all required fields", () => {
    const result = buildIssueLayer({
      number: 42,
      title: "Fix critical bug",
      body: "Detailed description",
      labels: ["bug", "priority"],
      repository: {
        owner: "my-org",
        name: "my-repo",
        baseBranch: "main",
        workBranch: "fix/42-bug",
      },
      planSummary: "Fix the bug in 2 phases",
    });

    expect(result.number).toBe(42);
    expect(result.title).toBe("Fix critical bug");
    expect(result.body).toBe("Detailed description");
    expect(result.labels).toEqual(["bug", "priority"]);
    expect(result.repository.owner).toBe("my-org");
    expect(result.repository.name).toBe("my-repo");
    expect(result.repository.baseBranch).toBe("main");
    expect(result.repository.workBranch).toBe("fix/42-bug");
    expect(result.planSummary).toBe("Fix the bug in 2 phases");
  });

  it("should handle empty labels", () => {
    const result = buildIssueLayer({
      number: 1,
      title: "Test",
      body: "",
      labels: [],
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "b" },
      planSummary: "",
    });
    expect(result.labels).toEqual([]);
  });
});

describe("buildLearningLayer", () => {
  it("should create empty learning layer when no config provided", () => {
    const result = buildLearningLayer();

    expect(result.pastFailures).toEqual([]);
    expect(result.errorPatterns).toEqual([]);
    expect(result.learnedPatterns).toEqual([]);
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should create learning layer with provided data", () => {
    const result = buildLearningLayer({
      pastFailures: [
        { context: "Phase 1", message: "Login error", resolution: "Run /login" },
        { context: "Phase 2", message: "Type error" },
      ],
      errorPatterns: ["Not logged in", "TS error"],
      learnedPatterns: ["Always check auth first"],
      updatedAt: "2026-04-10T00:00:00.000Z",
    });

    expect(result.pastFailures).toHaveLength(2);
    expect(result.pastFailures[0].context).toBe("Phase 1");
    expect(result.pastFailures[0].resolution).toBe("Run /login");
    expect(result.pastFailures[1].resolution).toBeUndefined();
    expect(result.errorPatterns).toEqual(["Not logged in", "TS error"]);
    expect(result.learnedPatterns).toEqual(["Always check auth first"]);
    expect(result.updatedAt).toBe("2026-04-10T00:00:00.000Z");
  });

  it("should use defaults for missing optional fields", () => {
    const result = buildLearningLayer({ updatedAt: "2026-04-10T00:00:00.000Z" });
    expect(result.pastFailures).toEqual([]);
    expect(result.errorPatterns).toEqual([]);
    expect(result.learnedPatterns).toEqual([]);
  });
});

describe("computeLayerCacheKey", () => {
  it("should return 16-char hex string", () => {
    const key = computeLayerCacheKey({ role: "Developer", rulesDigest: "abc123" });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("should produce consistent keys for same input", () => {
    const fields = { role: "Developer", rulesDigest: "abc123" };
    expect(computeLayerCacheKey(fields)).toBe(computeLayerCacheKey(fields));
  });

  it("should produce different keys for different inputs", () => {
    const key1 = computeLayerCacheKey({ role: "Developer" });
    const key2 = computeLayerCacheKey({ role: "Architect" });
    expect(key1).not.toBe(key2);
  });

  it("should be order-independent (sorts keys)", () => {
    const key1 = computeLayerCacheKey({ a: "1", b: "2" });
    const key2 = computeLayerCacheKey({ b: "2", a: "1" });
    expect(key1).toBe(key2);
  });

  it("should handle numeric values", () => {
    const key = computeLayerCacheKey({ issueNumber: 42, version: 1 });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("assemblePrompt (5계층 PromptLayers)", () => {
  function createFiveLayerLayers(): PromptLayers {
    return {
      base: buildBaseLayer({ role: "Test Developer" }),
      project: buildProjectLayer({
        conventions: "TypeScript + ESM",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      }),
      issue: buildIssueLayer({
        number: 99,
        title: "5-layer Test Issue",
        body: "Issue body text",
        labels: ["feature"],
        repository: {
          owner: "five-org",
          name: "five-repo",
          baseBranch: "main",
          workBranch: "feat/99",
        },
        planSummary: "Five layer plan",
      }),
      phase: {
        currentPhase: {
          index: 2,
          totalCount: 3,
          name: "Implementation",
          description: "Implement the feature",
          targetFiles: ["src/feature.ts"],
        },
        previousResults: "Phase 1: SUCCESS",
      },
      learning: buildLearningLayer({
        pastFailures: [{ context: "Phase 1", message: "Login required", resolution: "Run /login" }],
        errorPatterns: ["Not logged in"],
        learnedPatterns: ["Check auth before start"],
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    };
  }

  it("should assemble 5-layer prompt with all layer variables", () => {
    const layers = createFiveLayerLayers();
    const template = "Role: {{role}}\nIssue #{{issue.number}}: {{issue.title}}\nPhase {{phase.index}}/{{phase.totalCount}}\nRepo: {{repository.owner}}/{{repository.name}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Role: Test Developer");
    expect(result.content).toContain("Issue #99: 5-layer Test Issue");
    expect(result.content).toContain("Phase 2/3");
    expect(result.content).toContain("Repo: five-org/five-repo");
    expect(result.cacheKey).toMatch(/^[a-f0-9]{16}$/);
    expect(result.cacheHit).toBe(false);
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should include learning layer data in variables", () => {
    const layers = createFiveLayerLayers();
    const template = "Patterns: {{errorPatterns}}\nLearned: {{learnedPatterns}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Not logged in");
    expect(result.content).toContain("Check auth before start");
  });

  it("should include plan summary from issue layer", () => {
    const layers = createFiveLayerLayers();
    const template = "Plan: {{plan.summary}}";

    const result = assemblePrompt(layers, template);

    expect(result.content).toContain("Plan: Five layer plan");
  });

  it("should generate consistent cache keys for same 5-layer content", () => {
    const layers1 = createFiveLayerLayers();
    const layers2 = createFiveLayerLayers();

    const r1 = assemblePrompt(layers1, "{{role}}");
    const r2 = assemblePrompt(layers2, "{{role}}");

    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  it("should generate different cache key from 3-layer for same role/conventions", () => {
    const threeLayers = {
      base: buildBaseLayer({ role: "Test Developer" }),
      project: buildProjectLayer({
        conventions: "TypeScript + ESM",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      }),
      phase: buildPhaseLayer({
        issue: { number: 99, title: "Test", body: "", labels: [] },
        planSummary: "",
        currentPhase: { index: 1, totalCount: 1, name: "P", description: "", targetFiles: [] },
        previousResults: "",
        repository: { owner: "five-org", name: "five-repo", baseBranch: "main", workBranch: "b" },
      }),
    };
    const fiveLayers = createFiveLayerLayers();

    const r3 = assemblePrompt(threeLayers, "{{role}}");
    const r5 = assemblePrompt(fiveLayers, "{{role}}");

    // Both produce valid 16-char hex keys
    expect(r3.cacheKey).toMatch(/^[a-f0-9]{16}$/);
    expect(r5.cacheKey).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("buildStaticLayers", () => {
  it("should return content string from base and project layers", () => {
    const base = buildBaseLayer({ role: "시니어 개발자" });
    const project = buildProjectLayer({
      conventions: "TypeScript + ESM",
      testCommand: "npx vitest run",
      lintCommand: "npx eslint src/",
    });

    const result = buildStaticLayers(base, project);

    expect(result.content).toContain("시니어 개발자");
    expect(result.content).toContain("TypeScript + ESM");
    expect(result.content).toContain("npx vitest run");
  });

  it("should return a 16-char hex cache key", () => {
    const base = buildBaseLayer({ role: "Developer" });
    const project = buildProjectLayer({
      conventions: "Conventions",
      testCommand: "test",
      lintCommand: "lint",
    });

    const result = buildStaticLayers(base, project);

    expect(result.cacheKey).toMatch(/^[a-f0-9]{16}$/);
  });

  it("should produce consistent cache keys for identical inputs", () => {
    const base = buildBaseLayer({ role: "Developer" });
    const project = buildProjectLayer({
      conventions: "Conventions",
      testCommand: "test",
      lintCommand: "lint",
    });

    const r1 = buildStaticLayers(base, project);
    const r2 = buildStaticLayers(base, project);

    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  it("should produce different cache keys for different conventions", () => {
    const base = buildBaseLayer({ role: "Developer" });
    const p1 = buildProjectLayer({ conventions: "TypeScript", testCommand: "test", lintCommand: "lint" });
    const p2 = buildProjectLayer({ conventions: "JavaScript", testCommand: "test", lintCommand: "lint" });

    const r1 = buildStaticLayers(base, p1);
    const r2 = buildStaticLayers(base, p2);

    expect(r1.cacheKey).not.toBe(r2.cacheKey);
  });

  it("should return an ISO 8601 createdAt timestamp", () => {
    const base = buildBaseLayer({ role: "Developer" });
    const project = buildProjectLayer({ conventions: "C", testCommand: "t", lintCommand: "l" });

    const result = buildStaticLayers(base, project);

    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("buildDynamicLayers", () => {
  function createTestInputs() {
    const issue = buildIssueLayer({
      number: 42,
      title: "Dynamic Test Issue",
      body: "Issue body",
      labels: ["bug"],
      repository: { owner: "org", name: "repo", baseBranch: "main", workBranch: "fix/42" },
      planSummary: "Fix the bug in 2 phases",
    });
    const phase = {
      currentPhase: {
        index: 2,
        totalCount: 3,
        name: "Implementation",
        description: "Implement the fix",
        targetFiles: ["src/fix.ts"],
      },
      previousResults: "Phase 1: SUCCESS",
    };
    const learning = buildLearningLayer({
      pastFailures: [{ context: "Phase 1", message: "Login error", resolution: "Run /login" }],
      errorPatterns: ["Not logged in"],
      learnedPatterns: ["Check auth first"],
      updatedAt: "2026-04-12T00:00:00.000Z",
    });
    return { issue, phase, learning };
  }

  it("should include issue variables in the result", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    expect(result.variables.issue).toBeDefined();
    const issueVars = result.variables.issue as Record<string, unknown>;
    expect(issueVars["number"]).toBe("42");
    expect(issueVars["title"]).toBe("Dynamic Test Issue");
    expect(issueVars["labels"]).toEqual(["bug"]);
  });

  it("should include phase variables in the result", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    const phaseVars = result.variables.phase as Record<string, unknown>;
    expect(phaseVars["index"]).toBe("2");
    expect(phaseVars["totalCount"]).toBe("3");
    expect(phaseVars["name"]).toBe("Implementation");
    expect(phaseVars["files"]).toEqual(["src/fix.ts"]);
  });

  it("should include previous phase results", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    const prev = result.variables.previousPhases as Record<string, unknown>;
    expect(prev["summary"]).toBe("Phase 1: SUCCESS");
  });

  it("should include learning layer data", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    expect(result.variables.errorPatterns).toEqual(["Not logged in"]);
    expect(result.variables.learnedPatterns).toEqual(["Check auth first"]);
    expect(result.variables.pastFailures).toContain("Phase 1");
    expect(result.variables.pastFailures).toContain("Login error");
    expect(result.variables.pastFailures).toContain("Run /login");
  });

  it("should include plan summary from issue layer", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    const plan = result.variables.plan as Record<string, unknown>;
    expect(plan["summary"]).toBe("Fix the bug in 2 phases");
  });

  it("should include repository info from issue layer", () => {
    const { issue, phase, learning } = createTestInputs();
    const result = buildDynamicLayers(issue, phase, learning);

    const repo = result.variables.repository as Record<string, unknown>;
    expect(repo["owner"]).toBe("org");
    expect(repo["name"]).toBe("repo");
  });
});

describe("assembleFromCached", () => {
  function createStaticAndDynamic() {
    const base = buildBaseLayer({ role: "시니어 개발자" });
    const project = buildProjectLayer({
      conventions: "TypeScript + ESM",
      testCommand: "npx vitest run",
      lintCommand: "npx eslint src/",
    });
    const staticResult = buildStaticLayers(base, project);

    const issue = buildIssueLayer({
      number: 99,
      title: "Cache Test Issue",
      body: "Body",
      labels: ["feature"],
      repository: { owner: "org", name: "repo", baseBranch: "main", workBranch: "feat/99" },
      planSummary: "Cached plan",
    });
    const phase = {
      currentPhase: {
        index: 1,
        totalCount: 2,
        name: "Phase One",
        description: "First phase",
        targetFiles: ["src/feature.ts"],
      },
      previousResults: "",
    };
    const learning = buildLearningLayer();
    const dynamicResult = buildDynamicLayers(issue, phase, learning);

    return { staticResult, dynamicResult };
  }

  it("should prepend static content before rendered template", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const template = "Issue #{{issue.number}}: {{issue.title}}";

    const result = assembleFromCached(staticResult, dynamicResult, template);

    expect(result.content).toContain("시니어 개발자");
    expect(result.content).toContain("TypeScript + ESM");
    expect(result.content).toContain("Issue #99: Cache Test Issue");
    // static comes before dynamic
    expect(result.content.indexOf("시니어 개발자")).toBeLessThan(result.content.indexOf("Issue #99"));
  });

  it("should use static cache key in result", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const result = assembleFromCached(staticResult, dynamicResult, "{{issue.title}}");

    expect(result.cacheKey).toBe(staticResult.cacheKey);
  });

  it("should set cacheHit to true", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const result = assembleFromCached(staticResult, dynamicResult, "{{issue.title}}");

    expect(result.cacheHit).toBe(true);
  });

  it("should render dynamic template variables", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const template = "Phase {{phase.index}}/{{phase.totalCount}}: {{phase.name}}\nRepo: {{repository.owner}}/{{repository.name}}";

    const result = assembleFromCached(staticResult, dynamicResult, template);

    expect(result.content).toContain("Phase 1/2: Phase One");
    expect(result.content).toContain("Repo: org/repo");
  });

  it("should record assembly time", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const result = assembleFromCached(staticResult, dynamicResult, "{{issue.title}}");

    expect(typeof result.assemblyTimeMs).toBe("number");
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should leave unresolved variables unchanged", () => {
    const { staticResult, dynamicResult } = createStaticAndDynamic();
    const result = assembleFromCached(staticResult, dynamicResult, "{{unknown.var}}");

    expect(result.content).toContain("{{unknown.var}}");
  });
});
