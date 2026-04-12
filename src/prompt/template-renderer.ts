import { readFileSync } from "fs";
import { createHash } from "crypto";
import type {
  BaseLayer,
  ProjectLayer,
  PhaseLayer,
  PromptLayer,
  AssembledPrompt
} from "../types/pipeline.js";
import type {
  IssueLayer,
  LearningLayer,
  PromptLayers,
} from "./layer-types.js";

export interface TemplateVariables {
  [key: string]: string | number | boolean | string[] | TemplateVariables;
}

function resolvePath(
  variables: TemplateVariables,
  path: string
): string | undefined {
  const parts = path.split(".");
  let current: string | number | boolean | string[] | TemplateVariables =
    variables;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    const obj = current as TemplateVariables;
    if (!Object.prototype.hasOwnProperty.call(obj, part)) {
      return undefined;
    }
    current = obj[part];
  }

  if (current === undefined || current === null) {
    return undefined;
  }
  if (Array.isArray(current)) {
    return current.join(", ");
  }
  if (typeof current === "boolean" || typeof current === "number") {
    return String(current);
  }
  if (typeof current === "string") {
    return current;
  }
  // TemplateVariables object - not directly renderable, return undefined
  return undefined;
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  // Match {{var}}, {{ var }}, {{nested.path}}, {{ nested.path }} (double-brace)
  // Also match {var}, {nested.path} (single-brace, but not already double-brace)
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
      const value = resolvePath(variables, path.trim());
      return value !== undefined ? value : _match;
    })
    .replace(/(?<!\{)\{([\w.]+)\}(?!\})/g, (_match, path: string) => {
      const value = resolvePath(variables, path.trim());
      return value !== undefined ? value : _match;
    });
}

export function loadTemplate(templatePath: string): string {
  try {
    return readFileSync(templatePath, "utf-8");
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === "ENOENT") {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    throw new Error(
      `Failed to read template file ${templatePath}: ${error.message}`
    );
  }
}

/**
 * 기본 레이어를 구축합니다. 역할과 규칙 등 정적 내용을 포함합니다.
 */
export function buildBaseLayer(config: {
  role: string;
  locale?: string;
}): BaseLayer {
  const rules = [
    "이 Phase의 대상 파일만 수정하세요. 범위를 벗어난 파일은 수정하지 마세요.",
    "구현이 완료되면 반드시 git add + git commit을 수행하세요.",
    "검증이 실패하면 수정 후 다시 검증하세요.",
    "불필요한 파일, 주석, console.log를 추가하지 마세요.",
    "기존 코드 스타일과 패턴을 따르세요.",
    "any 금지: src/ 내 any 타입 사용 금지. unknown + 타입 가드로 좁힐 것.",
    "에러 핸들링: catch (err: unknown) + getErrorMessage(err) 패턴.",
    "ESM import: 반드시 .js 확장자 포함.",
    "logger 사용: console.log 대신 getLogger() 사용.",
    "safety guard: SafetyViolationError를 catch해서 삼키지 말 것."
  ];

  const outputFormat = `구현 완료 후 아래 JSON을 출력하세요:

\`\`\`json
{
  "phaseIndex": <number>,
  "phaseName": "<Phase 이름>",
  "filesModified": ["<수정한 파일 경로>", ...],
  "testsAdded": ["<추가한 테스트>", ...],
  "commitMessage": "<커밋 메시지>",
  "notes": "<특이사항>"
}
\`\`\``;

  const progressReporting = `작업 중 2분마다 현재 진행 상황을 한 줄로 출력하세요. 형식:
\`[HEARTBEAT] Phase <N>: <현재 하고 있는 작업> (<진행률>)\`

예시:
- \`[HEARTBEAT] Phase 1: src/components/Chat.tsx 수정 중 (30%)\`
- \`[HEARTBEAT] Phase 2: 테스트 작성 중 (80%)\`

**출력이 5분간 없으면 시스템이 작업을 중단합니다.** 반드시 주기적으로 진행 상황을 보고하세요.`;

  const parallelWorkGuide = `**서브에이전트 활용이 활성화되어 있습니다.** 독립적인 파일들을 병렬로 처리하여 효율성을 높이세요.

### 병렬 처리 권장 사항
- **독립적인 파일 수정**: 서로 의존성이 없는 파일들은 동시에 작업하세요
- **컴포넌트별 분리**: UI 컴포넌트, 유틸리티, 테스트 파일 등을 병렬로 처리하세요
- **다중 도구 호출**: 여러 도구를 한 번에 호출하여 작업 속도를 높이세요

### 예시
\`\`\`
여러 파일을 동시에 수정하는 경우:
- src/utils/helper.ts (독립적 유틸리티)
- src/components/Button.tsx (UI 컴포넌트)
- tests/helper.test.ts (테스트 파일)
\`\`\``;

  return {
    role: config.role,
    rules,
    outputFormat,
    progressReporting,
    parallelWorkGuide,
  };
}

/**
 * 프로젝트 레이어를 구축합니다. 프로젝트별 설정과 컨벤션을 포함합니다.
 */
export function buildProjectLayer(config: {
  conventions: string;
  structure?: string;
  skillsContext?: string;
  pastFailures?: string;
  testCommand: string;
  lintCommand: string;
  safetyRules?: string[];
}): ProjectLayer {
  const defaultSafetyRules = [
    "config 필드 추가 시: types/config.ts + config/defaults.ts + config/validator.ts 3곳 동시 수정 필수",
    "안전장치 우회 금지. safety guard를 비활성화하는 코드 작성하지 않는다",
    "git add -f 절대 금지",
  ];

  return {
    conventions: config.conventions,
    structure: config.structure || "",
    skillsContext: config.skillsContext,
    pastFailures: config.pastFailures,
    testCommand: config.testCommand,
    lintCommand: config.lintCommand,
    safetyRules: config.safetyRules || defaultSafetyRules,
  };
}

/**
 * Phase 레이어를 구축합니다. 현재 실행 컨텍스트와 동적 정보를 포함합니다.
 */
export function buildPhaseLayer(config: {
  issue: {
    number: number;
    title: string;
    body: string;
    labels: string[];
  };
  planSummary: string;
  currentPhase: {
    index: number;
    totalCount: number;
    name: string;
    description: string;
    targetFiles: string[];
  };
  previousResults: string;
  repository: {
    owner: string;
    name: string;
    baseBranch: string;
    workBranch: string;
  };
  locale?: string;
}): PhaseLayer {
  return {
    issue: config.issue,
    planSummary: config.planSummary,
    currentPhase: config.currentPhase,
    previousResults: config.previousResults,
    repository: config.repository,
    locale: config.locale,
  };
}

/**
 * 이슈 레이어를 구축합니다. GitHub 이슈 정보와 저장소 메타데이터를 포함합니다.
 */
export function buildIssueLayer(config: {
  number: number;
  title: string;
  body: string;
  labels: string[];
  repository: {
    owner: string;
    name: string;
    baseBranch: string;
    workBranch: string;
  };
  planSummary: string;
}): IssueLayer {
  return {
    number: config.number,
    title: config.title,
    body: config.body,
    labels: config.labels,
    repository: config.repository,
    planSummary: config.planSummary,
  };
}

/**
 * 학습 레이어를 구축합니다. 과거 실패 사례, 에러 패턴, 베스트 프랙티스를 포함합니다.
 */
export function buildLearningLayer(config?: {
  pastFailures?: Array<{
    context: string;
    message: string;
    resolution?: string;
  }>;
  errorPatterns?: string[];
  learnedPatterns?: string[];
  updatedAt?: string;
}): LearningLayer {
  return {
    pastFailures: config?.pastFailures ?? [],
    errorPatterns: config?.errorPatterns ?? [],
    learnedPatterns: config?.learnedPatterns ?? [],
    updatedAt: config?.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * 레이어별 캐시 키를 계산합니다.
 * 전달한 필드를 키 기준 정렬 후 SHA-256 해시의 앞 16자리를 반환합니다.
 */
export function computeLayerCacheKey(
  fields: Record<string, string | number>
): string {
  const material = Object.keys(fields)
    .sort()
    .map(k => `${k}=${String(fields[k])}`)
    .join("&");
  return createHash("sha256").update(material).digest("hex").substring(0, 16);
}

/**
 * 동적 섹션(이슈, 저장소, 설정)을 구성합니다.
 */
export function buildDynamicSection(data: {
  issue: { number: number; title: string; body: string; labels: string[] };
  repo: { owner: string; name: string; structure: string };
  branch: { base: string; work: string };
  config: { maxPhases: number; sensitivePaths: string };
}): string {
  const sanitizedBody = `<USER_INPUT>\n${data.issue.body.replace(/<\/USER_INPUT>/gi, "&lt;/USER_INPUT&gt;")}\n</USER_INPUT>`;

  return `
# 이슈 정보

**번호**: #${data.issue.number}
**제목**: ${data.issue.title}
**라벨**: ${data.issue.labels.join(", ")}

**본문**:
${sanitizedBody}

# 저장소 정보

**소유자**: ${data.repo.owner}
**이름**: ${data.repo.name}
**구조**:
${data.repo.structure}

**브랜치**: ${data.branch.base} → ${data.branch.work}

# 설정

**최대 Phase 수**: ${data.config.maxPhases}
**민감한 경로**: ${data.config.sensitivePaths}
`;
}

/**
 * 정적 레이어(Base + Project)를 조립한 콘텐츠를 생성합니다.
 */
export function buildStaticContent(baseLayer: BaseLayer, projectLayer: ProjectLayer): string {
  return `# ${baseLayer.role}

${baseLayer.rules.map(rule => `- ${rule}`).join('\n')}

${baseLayer.outputFormat}

${baseLayer.progressReporting}

${baseLayer.parallelWorkGuide}

## 프로젝트 컨벤션

${projectLayer.conventions}

## 프로젝트 구조

${projectLayer.structure}

## 설정

- 테스트 명령어: ${projectLayer.testCommand}
- 린트 명령어: ${projectLayer.lintCommand}

## 안전 규칙

${projectLayer.safetyRules.map(rule => `- ${rule}`).join('\n')}

${projectLayer.skillsContext ? `## 스킬 컨텍스트\n\n${projectLayer.skillsContext}` : ''}

${projectLayer.pastFailures ? `## 과거 실패 사례\n\n${projectLayer.pastFailures}` : ''}`;
}

// ---------------------------------------------------------------------------
// 캐시 친화적 조립 타입 및 함수
// ---------------------------------------------------------------------------

/**
 * buildStaticLayers 반환값 — Base+Project 조립 결과
 */
export interface StaticLayersResult {
  /** 정적 레이어(Base+Project) 조립 결과 문자열 */
  content: string;
  /** 정적 레이어 캐시 키 (16자리 hex) */
  cacheKey: string;
  /** 생성 시각 (ISO 8601) */
  createdAt: string;
}

/**
 * buildDynamicLayers 반환값 — Issue+Phase+Learning 변수 맵
 */
export interface DynamicLayersResult {
  /** 템플릿 렌더링에 사용할 변수 맵 */
  variables: TemplateVariables;
}

/**
 * 정적 레이어(Base+Project)를 1회 조립합니다.
 * 반환된 content는 Anthropic 프롬프트 캐싱에서 정적 블록으로 활용할 수 있습니다.
 */
export function buildStaticLayers(
  base: BaseLayer,
  project: ProjectLayer
): StaticLayersResult {
  const content = buildStaticContent(base, project);
  const cacheKey = computeLayerCacheKey({
    role: base.role,
    conventions: project.conventions,
    testCommand: project.testCommand,
    lintCommand: project.lintCommand,
  });
  return {
    content,
    cacheKey,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 동적 레이어(Issue+Phase+Learning)를 변수 맵으로 조립합니다.
 * Phase마다 새로 생성하며, assembleFromCached에 전달합니다.
 * phase 파라미터는 currentPhase와 previousResults만 사용합니다.
 */
export function buildDynamicLayers(
  issue: IssueLayer,
  phase: Pick<PhaseLayer, "currentPhase" | "previousResults">,
  learning: LearningLayer
): DynamicLayersResult {
  const pastFailuresText = learning.pastFailures
    .map(f => `- ${f.context}: ${f.message}${f.resolution ? ` (해결: ${f.resolution})` : ""}`)
    .join("\n");

  return {
    variables: {
      issue: {
        number: String(issue.number),
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      },
      plan: {
        summary: issue.planSummary,
      },
      repository: issue.repository as unknown as TemplateVariables,
      phase: {
        index: String(phase.currentPhase.index),
        totalCount: String(phase.currentPhase.totalCount),
        name: phase.currentPhase.name,
        description: phase.currentPhase.description,
        files: phase.currentPhase.targetFiles,
      },
      previousPhases: {
        summary: phase.previousResults,
      },
      pastFailures: pastFailuresText,
      errorPatterns: learning.errorPatterns,
      learnedPatterns: learning.learnedPatterns,
    },
  };
}

/**
 * 캐시된 정적 레이어와 동적 레이어를 조합하여 최종 프롬프트를 생성합니다.
 * templateContent는 동적 변수(issue, phase, learning 관련)를 참조하는 템플릿입니다.
 * 정적 content(Base+Project)는 그대로 prepend되므로 Anthropic API에서 cache_control로 캐시 가능합니다.
 */
export function assembleFromCached(
  staticResult: StaticLayersResult,
  dynamicResult: DynamicLayersResult,
  templateContent: string
): AssembledPrompt {
  const startTime = Date.now();
  const renderedDynamic = renderTemplate(templateContent, dynamicResult.variables);
  const content = `${staticResult.content}\n\n${renderedDynamic}`;

  return {
    content,
    cacheKey: staticResult.cacheKey,
    cacheHit: true,
    assemblyTimeMs: Date.now() - startTime,
  };
}

/**
 * PromptLayers(5계층) 여부를 판별하는 타입 가드
 */
function isPromptLayers(
  layers: PromptLayer | PromptLayers
): layers is PromptLayers {
  return "issue" in layers && "learning" in layers;
}

/**
 * 전체 프롬프트 레이어를 조립합니다.
 * 3계층(PromptLayer)과 5계층(PromptLayers) 모두 지원합니다.
 */
export function assemblePrompt(
  layers: PromptLayer | PromptLayers,
  templateContent: string
): AssembledPrompt {
  const startTime = Date.now();

  if (isPromptLayers(layers)) {
    // 5계층 경로
    const cacheKey = computeLayerCacheKey({
      role: layers.base.role,
      conventions: layers.project.conventions,
      issueNumber: layers.issue.number,
      repo: `${layers.issue.repository.owner}/${layers.issue.repository.name}`,
      learningUpdatedAt: layers.learning.updatedAt,
    });

    const pastFailuresText = layers.learning.pastFailures
      .map(f => `- ${f.context}: ${f.message}${f.resolution ? ` (해결: ${f.resolution})` : ""}`)
      .join("\n");

    const variables: TemplateVariables = {
      // Base Layer
      role: layers.base.role,
      rules: layers.base.rules,
      outputFormat: layers.base.outputFormat,
      progressReporting: layers.base.progressReporting,
      parallelWorkGuide: layers.base.parallelWorkGuide,

      // Project Layer
      projectConventions: layers.project.conventions,
      projectStructure: layers.project.structure,
      skillsContext: layers.project.skillsContext || "",
      config: {
        testCommand: layers.project.testCommand,
        lintCommand: layers.project.lintCommand,
      },
      safetyRules: layers.project.safetyRules,

      // Issue Layer
      issue: {
        number: String(layers.issue.number),
        title: layers.issue.title,
        body: layers.issue.body,
        labels: layers.issue.labels,
      },
      plan: {
        summary: layers.issue.planSummary,
      },
      repository: layers.issue.repository,

      // Phase Layer
      phase: {
        index: String(layers.phase.currentPhase.index),
        totalCount: String(layers.phase.currentPhase.totalCount),
        name: layers.phase.currentPhase.name,
        description: layers.phase.currentPhase.description,
        files: layers.phase.currentPhase.targetFiles,
      },
      previousPhases: {
        summary: layers.phase.previousResults,
      },

      // Learning Layer
      pastFailures: pastFailuresText,
      errorPatterns: layers.learning.errorPatterns,
      learnedPatterns: layers.learning.learnedPatterns,
    };

    const assembledContent = renderTemplate(templateContent, variables);

    return {
      content: assembledContent,
      cacheKey,
      cacheHit: false,
      assemblyTimeMs: Date.now() - startTime,
    };
  }

  // 3계층 경로 (하위호환)
  const cacheKey = createHash("sha256")
    .update(layers.base.role + JSON.stringify(layers.base.rules) + layers.project.conventions)
    .digest("hex")
    .substring(0, 16);

  const variables: TemplateVariables = {
    // Base Layer
    role: layers.base.role,
    rules: layers.base.rules,
    outputFormat: layers.base.outputFormat,
    progressReporting: layers.base.progressReporting,
    parallelWorkGuide: layers.base.parallelWorkGuide,

    // Project Layer
    projectConventions: layers.project.conventions,
    projectStructure: layers.project.structure,
    skillsContext: layers.project.skillsContext || "",
    pastFailures: layers.project.pastFailures || "",
    config: {
      testCommand: layers.project.testCommand,
      lintCommand: layers.project.lintCommand,
    },
    safetyRules: layers.project.safetyRules,

    // Phase Layer
    issue: {
      number: String(layers.phase.issue.number),
      title: layers.phase.issue.title,
      body: layers.phase.issue.body,
      labels: layers.phase.issue.labels,
    },
    plan: {
      summary: layers.phase.planSummary,
    },
    phase: {
      index: String(layers.phase.currentPhase.index),
      totalCount: String(layers.phase.currentPhase.totalCount),
      name: layers.phase.currentPhase.name,
      description: layers.phase.currentPhase.description,
      files: layers.phase.currentPhase.targetFiles,
    },
    previousPhases: {
      summary: layers.phase.previousResults,
    },
    repository: layers.phase.repository,
  };

  const assembledContent = renderTemplate(templateContent, variables);

  return {
    content: assembledContent,
    cacheKey,
    cacheHit: false,
    assemblyTimeMs: Date.now() - startTime,
  };
}
