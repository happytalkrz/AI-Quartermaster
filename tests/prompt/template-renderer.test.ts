import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  renderTemplate,
  buildBaseLayer,
  buildProjectLayer,
  buildPhaseLayer,
  buildStaticContent,
  assemblePrompt,
  assembleLayeredPrompt,
  loadLayerTemplates,
} from "../../src/prompt/template-renderer.js";
import type { PromptLayer, CachedPromptLayer, PhaseLayer } from "../../src/types/pipeline.js";

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

describe("assembleLayeredPrompt", () => {
  function createTestCachedLayer(phaseTemplate?: string): CachedPromptLayer {
    const base = buildBaseLayer({ role: "Test Developer" });
    const project = buildProjectLayer({
      conventions: "TypeScript + ESM",
      testCommand: "npm test",
      lintCommand: "npm run lint",
    });
    return {
      staticContent: buildStaticContent(base, project),
      cacheKey: "abc123def456789",
      createdAt: new Date().toISOString(),
      phaseTemplate: phaseTemplate ?? "Issue #{{issue.number}}: {{issue.title}}\nPhase {{phase.index}}/{{phase.totalCount}}",
    };
  }

  function createTestPhaseLayer(): PhaseLayer {
    return buildPhaseLayer({
      issue: {
        number: 42,
        title: "Test Issue",
        body: "Test body",
        labels: ["bug"],
      },
      planSummary: "Test plan summary",
      currentPhase: {
        index: 2,
        totalCount: 3,
        name: "Implementation",
        description: "Implement the feature",
        targetFiles: ["src/foo.ts"],
      },
      previousResults: "Phase 1: SUCCESS",
      repository: {
        owner: "test-org",
        name: "test-repo",
        baseBranch: "main",
        workBranch: "feature/42",
      },
    });
  }

  it("should combine static content and rendered phase template", () => {
    const cachedLayer = createTestCachedLayer();
    const phaseLayer = createTestPhaseLayer();

    const result = assembleLayeredPrompt(cachedLayer, phaseLayer);

    expect(result.content).toContain(cachedLayer.staticContent);
    expect(result.content).toContain("Issue #42: Test Issue");
    expect(result.content).toContain("Phase 2/3");
  });

  it("should mark cacheHit as true", () => {
    const result = assembleLayeredPrompt(createTestCachedLayer(), createTestPhaseLayer());
    expect(result.cacheHit).toBe(true);
  });

  it("should preserve the cache key from cached layer", () => {
    const cachedLayer = createTestCachedLayer();
    const result = assembleLayeredPrompt(cachedLayer, createTestPhaseLayer());
    expect(result.cacheKey).toBe("abc123def456789");
  });

  it("should render all phase variables correctly", () => {
    const template = "{{issue.title}} | {{plan.summary}} | {{phase.name}} | {{previousPhases.summary}} | {{repository.owner}}/{{repository.name}}";
    const cachedLayer = createTestCachedLayer(template);
    const phaseLayer = createTestPhaseLayer();

    const result = assembleLayeredPrompt(cachedLayer, phaseLayer);

    expect(result.content).toContain("Test Issue");
    expect(result.content).toContain("Test plan summary");
    expect(result.content).toContain("Implementation");
    expect(result.content).toContain("Phase 1: SUCCESS");
    expect(result.content).toContain("test-org/test-repo");
  });

  it("should render phase.files as comma-separated list", () => {
    const template = "Files: {{phase.files}}";
    const phaseLayer = buildPhaseLayer({
      issue: { number: 1, title: "T", body: "B", labels: [] },
      planSummary: "",
      currentPhase: {
        index: 1,
        totalCount: 1,
        name: "N",
        description: "D",
        targetFiles: ["a.ts", "b.ts", "c.ts"],
      },
      previousResults: "",
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "w" },
    });

    const result = assembleLayeredPrompt(createTestCachedLayer(template), phaseLayer);
    expect(result.content).toContain("Files: a.ts, b.ts, c.ts");
  });

  it("should measure assembly time", () => {
    const result = assembleLayeredPrompt(createTestCachedLayer(), createTestPhaseLayer());
    expect(typeof result.assemblyTimeMs).toBe("number");
    expect(result.assemblyTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.assemblyTimeMs).toBeLessThan(1000);
  });
});

describe("loadLayerTemplates", () => {
  const promptsDir = join(process.cwd(), "prompts");

  it("should load all three layer templates", () => {
    const templates = loadLayerTemplates(promptsDir);

    expect(typeof templates.baseTemplate).toBe("string");
    expect(typeof templates.projectTemplate).toBe("string");
    expect(typeof templates.phaseTemplate).toBe("string");
    expect(templates.baseTemplate.length).toBeGreaterThan(0);
    expect(templates.projectTemplate.length).toBeGreaterThan(0);
    expect(templates.phaseTemplate.length).toBeGreaterThan(0);
  });

  it("should load phase template with expected variables", () => {
    const templates = loadLayerTemplates(promptsDir);
    expect(templates.phaseTemplate).toContain("{{issue.number}}");
    expect(templates.phaseTemplate).toContain("{{phase.index}}");
  });

  it("should load project template with expected variables", () => {
    const templates = loadLayerTemplates(promptsDir);
    expect(templates.projectTemplate).toContain("{{projectConventions}}");
  });

  it("should throw when directory does not exist", () => {
    expect(() => loadLayerTemplates("/nonexistent/path")).toThrow();
  });
});
