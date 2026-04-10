import { describe, it, expect } from "vitest";
import {
  buildIssueLayer,
  buildLearningLayer,
  computeLayerCacheKey,
  buildBaseLayer,
  buildProjectLayer,
} from "../../src/prompt/template-renderer.js";
import type {
  IssueLayer,
  LearningLayer,
  PhaseLayer,
  PromptLayers,
  CacheKeyConfig,
} from "../../src/prompt/layer-types.js";

// ---------------------------------------------------------------------------
// IssueLayer 타입 계약
// ---------------------------------------------------------------------------

describe("IssueLayer 구조", () => {
  it("buildIssueLayer 결과가 IssueLayer 인터페이스를 충족한다", () => {
    const layer: IssueLayer = buildIssueLayer({
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

    expect(layer.number).toBe(42);
    expect(layer.title).toBe("Fix critical bug");
    expect(layer.body).toBe("Detailed description");
    expect(layer.labels).toEqual(["bug", "priority"]);
    expect(layer.repository.owner).toBe("my-org");
    expect(layer.repository.name).toBe("my-repo");
    expect(layer.repository.baseBranch).toBe("main");
    expect(layer.repository.workBranch).toBe("fix/42-bug");
    expect(layer.planSummary).toBe("Fix the bug in 2 phases");
  });

  it("repository 중첩 구조가 모든 필수 필드를 포함한다", () => {
    const layer = buildIssueLayer({
      number: 1,
      title: "T",
      body: "B",
      labels: [],
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "b" },
      planSummary: "P",
    });

    expect(layer.repository).toHaveProperty("owner");
    expect(layer.repository).toHaveProperty("name");
    expect(layer.repository).toHaveProperty("baseBranch");
    expect(layer.repository).toHaveProperty("workBranch");
  });

  it("빈 labels와 빈 body를 허용한다", () => {
    const layer = buildIssueLayer({
      number: 0,
      title: "Empty",
      body: "",
      labels: [],
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "b" },
      planSummary: "",
    });

    expect(layer.labels).toEqual([]);
    expect(layer.body).toBe("");
    expect(layer.planSummary).toBe("");
  });

  it("다수의 labels를 배열로 유지한다", () => {
    const layer = buildIssueLayer({
      number: 1,
      title: "T",
      body: "B",
      labels: ["bug", "feature", "help-wanted", "good-first-issue"],
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "b" },
      planSummary: "P",
    });

    expect(layer.labels).toHaveLength(4);
    expect(layer.labels).toContain("good-first-issue");
  });
});

// ---------------------------------------------------------------------------
// LearningLayer 타입 계약
// ---------------------------------------------------------------------------

describe("LearningLayer 구조", () => {
  it("buildLearningLayer() 결과가 LearningLayer 인터페이스를 충족한다", () => {
    const layer: LearningLayer = buildLearningLayer();

    expect(layer).toHaveProperty("pastFailures");
    expect(layer).toHaveProperty("errorPatterns");
    expect(layer).toHaveProperty("learnedPatterns");
    expect(layer).toHaveProperty("updatedAt");
    expect(Array.isArray(layer.pastFailures)).toBe(true);
    expect(Array.isArray(layer.errorPatterns)).toBe(true);
    expect(Array.isArray(layer.learnedPatterns)).toBe(true);
  });

  it("인자 없이 호출하면 모든 배열이 비어 있고 updatedAt이 ISO 8601 형식이다", () => {
    const layer = buildLearningLayer();

    expect(layer.pastFailures).toEqual([]);
    expect(layer.errorPatterns).toEqual([]);
    expect(layer.learnedPatterns).toEqual([]);
    expect(layer.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("pastFailures 각 항목이 context, message를 가지며 resolution은 선택이다", () => {
    const layer = buildLearningLayer({
      pastFailures: [
        { context: "Phase 1", message: "Login error", resolution: "Run /login" },
        { context: "Phase 2", message: "Type error" },
      ],
    });

    expect(layer.pastFailures[0].context).toBe("Phase 1");
    expect(layer.pastFailures[0].message).toBe("Login error");
    expect(layer.pastFailures[0].resolution).toBe("Run /login");
    expect(layer.pastFailures[1].resolution).toBeUndefined();
  });

  it("updatedAt을 명시하면 그 값을 그대로 보존한다", () => {
    const ts = "2026-04-10T12:34:56.789Z";
    const layer = buildLearningLayer({ updatedAt: ts });
    expect(layer.updatedAt).toBe(ts);
  });

  it("일부 필드만 제공하면 나머지는 빈 배열로 기본값 처리된다", () => {
    const layer = buildLearningLayer({ learnedPatterns: ["Always check auth"] });
    expect(layer.pastFailures).toEqual([]);
    expect(layer.errorPatterns).toEqual([]);
    expect(layer.learnedPatterns).toEqual(["Always check auth"]);
  });
});

// ---------------------------------------------------------------------------
// PhaseLayer 타입 계약
// ---------------------------------------------------------------------------

describe("PhaseLayer 구조", () => {
  it("PhaseLayer 인터페이스에 맞는 객체를 직접 생성할 수 있다", () => {
    const layer: PhaseLayer = {
      currentPhase: {
        index: 1,
        totalCount: 3,
        name: "Implementation",
        description: "Implement the feature",
        targetFiles: ["src/feature.ts", "tests/feature.test.ts"],
      },
      previousResults: "Phase 0: SUCCESS",
    };

    expect(layer.currentPhase.index).toBe(1);
    expect(layer.currentPhase.totalCount).toBe(3);
    expect(layer.currentPhase.targetFiles).toHaveLength(2);
    expect(layer.previousResults).toBe("Phase 0: SUCCESS");
    expect(layer.locale).toBeUndefined();
  });

  it("locale 필드는 선택적으로 지정 가능하다", () => {
    const layer: PhaseLayer = {
      currentPhase: {
        index: 2,
        totalCount: 2,
        name: "Test",
        description: "Write tests",
        targetFiles: [],
      },
      previousResults: "",
      locale: "en",
    };

    expect(layer.locale).toBe("en");
  });

  it("previousResults가 빈 문자열인 경우를 허용한다 (첫 Phase)", () => {
    const layer: PhaseLayer = {
      currentPhase: {
        index: 1,
        totalCount: 1,
        name: "Only Phase",
        description: "Do everything",
        targetFiles: [],
      },
      previousResults: "",
    };

    expect(layer.previousResults).toBe("");
  });
});

// ---------------------------------------------------------------------------
// PromptLayers 5계층 조합
// ---------------------------------------------------------------------------

describe("PromptLayers 5계층 구조", () => {
  function makePromptLayers(): PromptLayers {
    return {
      base: buildBaseLayer({ role: "시니어 개발자" }),
      project: buildProjectLayer({
        conventions: "TypeScript + ESM + Vitest",
        testCommand: "npx vitest run",
        lintCommand: "npx eslint src/ tests/",
      }),
      issue: buildIssueLayer({
        number: 419,
        title: "refactor: 5-layer prompt",
        body: "Issue body",
        labels: ["refactor"],
        repository: {
          owner: "test-org",
          name: "ai-quartermaster",
          baseBranch: "main",
          workBranch: "aq/419-refactor",
        },
        planSummary: "5계층 레이어 분리",
      }),
      phase: {
        currentPhase: {
          index: 4,
          totalCount: 4,
          name: "테스트 추가",
          description: "레이어 타입 테스트 작성",
          targetFiles: ["tests/prompt/layer-types.test.ts"],
        },
        previousResults: "Phase 3: SUCCESS",
      },
      learning: buildLearningLayer({
        pastFailures: [{ context: "UNKNOWN", message: "Not logged in", resolution: "Run /login" }],
        errorPatterns: ["Not logged in"],
        learnedPatterns: ["Check auth before start"],
        updatedAt: "2026-04-10T00:00:00.000Z",
      }),
    };
  }

  it("모든 5개 레이어를 포함하는 PromptLayers를 생성할 수 있다", () => {
    const layers = makePromptLayers();

    expect(layers).toHaveProperty("base");
    expect(layers).toHaveProperty("project");
    expect(layers).toHaveProperty("issue");
    expect(layers).toHaveProperty("phase");
    expect(layers).toHaveProperty("learning");
  });

  it("각 레이어는 독립적인 타입 구조를 가진다", () => {
    const layers = makePromptLayers();

    // base
    expect(typeof layers.base.role).toBe("string");
    expect(Array.isArray(layers.base.rules)).toBe(true);

    // project
    expect(typeof layers.project.conventions).toBe("string");
    expect(typeof layers.project.testCommand).toBe("string");

    // issue
    expect(typeof layers.issue.number).toBe("number");
    expect(typeof layers.issue.repository.owner).toBe("string");

    // phase
    expect(typeof layers.phase.currentPhase.index).toBe("number");
    expect(Array.isArray(layers.phase.currentPhase.targetFiles)).toBe(true);

    // learning
    expect(Array.isArray(layers.learning.pastFailures)).toBe(true);
    expect(typeof layers.learning.updatedAt).toBe("string");
  });

  it("issue와 phase는 서로 독립적이다 (이슈 정보는 issue 레이어에만 있다)", () => {
    const layers = makePromptLayers();

    expect(layers.issue.number).toBe(419);
    expect(layers.issue.planSummary).toBe("5계층 레이어 분리");
    // phase는 currentPhase와 previousResults만 가진다
    expect(layers.phase).not.toHaveProperty("issue");
    expect(layers.phase).not.toHaveProperty("planSummary");
  });
});

// ---------------------------------------------------------------------------
// CacheKeyConfig 타입 계약
// ---------------------------------------------------------------------------

describe("CacheKeyConfig 구조", () => {
  it("CacheKeyConfig 인터페이스에 맞는 객체를 생성할 수 있다", () => {
    const config: CacheKeyConfig = {
      base: { role: "Developer", rulesDigest: "abc123" },
      project: { projectRoot: "/home/user/repo", conventionsDigest: "def456" },
      issue: { repo: "owner/repo", issueNumber: 42, bodyDigest: "ghi789" },
      learning: { repo: "owner/repo", issueNumber: 42, updatedAt: "2026-04-10T00:00:00.000Z" },
    };

    expect(config.base.role).toBe("Developer");
    expect(config.project.projectRoot).toBe("/home/user/repo");
    expect(config.issue.issueNumber).toBe(42);
    expect(config.learning.updatedAt).toBe("2026-04-10T00:00:00.000Z");
  });

  it("PhaseLayer 캐시 키 재료는 CacheKeyConfig에 포함되지 않는다", () => {
    const config: CacheKeyConfig = {
      base: { role: "Developer", rulesDigest: "abc" },
      project: { projectRoot: "/repo", conventionsDigest: "def" },
      issue: { repo: "o/r", issueNumber: 1, bodyDigest: "ghi" },
      learning: { repo: "o/r", issueNumber: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
    };

    // phase는 키 없음 — 타입이 강제하는 계약 확인
    expect(Object.keys(config)).not.toContain("phase");
  });
});

// ---------------------------------------------------------------------------
// computeLayerCacheKey 함수
// ---------------------------------------------------------------------------

describe("computeLayerCacheKey", () => {
  it("16자리 소문자 16진수 문자열을 반환한다", () => {
    const key = computeLayerCacheKey({ role: "Developer", rulesDigest: "abc123" });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("동일한 입력에 대해 항상 같은 키를 반환한다 (결정론적)", () => {
    const fields = { role: "Developer", issueNumber: 42 };
    expect(computeLayerCacheKey(fields)).toBe(computeLayerCacheKey(fields));
  });

  it("다른 입력에 대해 다른 키를 반환한다", () => {
    expect(computeLayerCacheKey({ role: "Developer" }))
      .not.toBe(computeLayerCacheKey({ role: "Architect" }));
  });

  it("키 순서에 무관하게 같은 결과를 반환한다 (순서 독립)", () => {
    const key1 = computeLayerCacheKey({ a: "1", b: "2", c: "3" });
    const key2 = computeLayerCacheKey({ c: "3", a: "1", b: "2" });
    expect(key1).toBe(key2);
  });

  it("숫자 값을 처리할 수 있다", () => {
    const key = computeLayerCacheKey({ issueNumber: 419, version: 1 });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("빈 객체에 대해서도 유효한 키를 반환한다", () => {
    const key = computeLayerCacheKey({});
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("BaseLayer 재료로 캐시 키를 계산할 수 있다", () => {
    const base = buildBaseLayer({ role: "시니어 개발자" });
    const key = computeLayerCacheKey({
      role: base.role,
      rulesDigest: base.rules.join("|"),
    });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("IssueLayer 재료로 캐시 키를 계산할 수 있다", () => {
    const issue = buildIssueLayer({
      number: 42,
      title: "Test",
      body: "Body",
      labels: [],
      repository: { owner: "o", name: "r", baseBranch: "main", workBranch: "b" },
      planSummary: "P",
    });
    const key = computeLayerCacheKey({
      repo: `${issue.repository.owner}/${issue.repository.name}`,
      issueNumber: issue.number,
      bodyDigest: issue.body,
    });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it("LearningLayer 재료로 캐시 키를 계산할 수 있다", () => {
    const learning = buildLearningLayer({ updatedAt: "2026-04-10T00:00:00.000Z" });
    const key = computeLayerCacheKey({
      repo: "owner/repo",
      issueNumber: 42,
      updatedAt: learning.updatedAt,
    });
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });
});
