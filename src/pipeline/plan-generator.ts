import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import * as ts from "typescript";
import { renderTemplate, loadTemplate, TemplateVariables } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import type { Plan, ContextualizationInfo, PlanRetryContext, PlanGenerationResult, ErrorCategory } from "../types/pipeline.js";

export interface PlanTemplateBaseData {
  issue: {
    number: string;
    title: string;
    body: string;
    labels: string[];
  };
  repo: {
    owner: string;
    name: string;
    structure: string;
  };
  branch: {
    base: string;
    work: string;
  };
  config: {
    maxPhases: string;
    sensitivePaths: string;
  };
}

export interface PlanTemplateRetryData extends PlanTemplateBaseData {
  retry: {
    attempt: number;
    maxRetries: number;
    failureReason: string;
    errorMessage: string;
    previousAttempts: Array<{
      attempt: number;
      failureReason: string;
      problemSummary: string;
    }>;
  };
  context: ContextualizationInfo;
}

export type PlanTemplateData = PlanTemplateBaseData | PlanTemplateRetryData;
import { notifyPlanRetryContext } from "../notification/notifier.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface PlanGeneratorContext {
  issue: GitHubIssue;
  repo: { owner: string; name: string };
  branch: { base: string; work: string };
  repoStructure: string;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  modeHint?: string;
  maxPhases?: number;
  sensitivePaths?: string;
}

export async function generatePlan(ctx: PlanGeneratorContext): Promise<Plan> {
  const maxRetries = 2;
  const retryContext: PlanRetryContext = {
    currentAttempt: 0,
    maxRetries,
    generationHistory: [],
    canRetry: true,
  };

  const planSchema = JSON.stringify({
    type: "object",
    properties: {
      mode: { type: "string", enum: ["code", "content"], description: "code: 코딩/구현 작업, content: 문서/블로그/설정 등 비코딩 작업" },
      issueNumber: { type: "number" },
      title: { type: "string" },
      problemDefinition: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
      affectedFiles: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      phases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            name: { type: "string" },
            description: { type: "string" },
            targetFiles: { type: "array", items: { type: "string" } },
            commitStrategy: { type: "string" },
            verificationCriteria: { type: "array", items: { type: "string" } },
            dependsOn: { type: "array", items: { type: "number" }, description: "Phase indices this phase depends on" },
          },
          required: ["name", "description"],
        },
      },
      verificationPoints: { type: "array", items: { type: "string" } },
      stopConditions: { type: "array", items: { type: "string" } },
    },
    required: ["mode", "issueNumber", "title", "problemDefinition", "phases"],
  });

  const maxPhases = String(ctx.maxPhases ?? 10);
  const sensitivePaths = ctx.sensitivePaths ?? "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    retryContext.currentAttempt = attempt - 1;
    const startTime = Date.now();

    let templatePath: string;
    let templateData: TemplateVariables;

    // 기본 데이터 구조
    const baseData = {
      issue: {
        number: String(ctx.issue.number),
        title: ctx.issue.title,
        body: attempt === 1 ? `<USER_INPUT>\n${ctx.issue.body}\n</USER_INPUT>` : ctx.issue.body,
        labels: ctx.issue.labels,
      },
      repo: {
        owner: ctx.repo.owner,
        name: ctx.repo.name,
        structure: ctx.repoStructure,
      },
      branch: ctx.branch,
      config: { maxPhases, sensitivePaths },
    };

    // 첫 시도는 일반 템플릿, 재시도는 retry 템플릿 사용
    if (attempt === 1) {
      templatePath = resolve(ctx.promptsDir, "plan-generation.md");
      templateData = baseData;
    } else {
      const retryTemplatePath = resolve(ctx.promptsDir, "plan-generation-retry.md");
      const useRetryTemplate = existsSync(retryTemplatePath);
      templatePath = useRetryTemplate ? retryTemplatePath : resolve(ctx.promptsDir, "plan-generation.md");

      const lastFailure = retryContext.generationHistory[retryContext.generationHistory.length - 1];
      templateData = useRetryTemplate
        ? {
            retry: {
              attempt,
              maxRetries,
              failureReason: lastFailure.errorCategory || "UNKNOWN",
              errorMessage: lastFailure.error || "Unknown error",
              previousAttempts: retryContext.generationHistory.map((h, i) => ({
                attempt: i + 1,
                failureReason: h.errorCategory || "UNKNOWN",
                problemSummary: h.error?.slice(0, 100) || "Unknown",
              })),
            },
            context: retryContext.contextualization || {
              functionSignatures: {},
              importRelations: {},
              typeDefinitions: {},
            },
            ...baseData,
          }
        : baseData;
    }

    const template = loadTemplate(templatePath);
    let finalPrompt = renderTemplate(template, templateData);

    if (ctx.modeHint) {
      finalPrompt += `\n\n## 추가 지시\n\n${ctx.modeHint}`;
    }

    logger.info(`Sending plan generation prompt (${finalPrompt.length} chars)${attempt > 1 ? ` [retry ${attempt}/${maxRetries}]` : ""}`);

    const result = await runClaude({
      prompt: finalPrompt,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "plan"),
      jsonSchema: planSchema,
      enableAgents: true,
    });

    const duration = Date.now() - startTime;
    let errorCategory: ErrorCategory | undefined;
    let errorMessage: string | undefined;

    if (!result.success) {
      errorCategory = "CLI_CRASH";
      errorMessage = result.output.slice(0, 200);

      // 히스토리 기록
      retryContext.generationHistory.push({
        success: false,
        error: errorMessage,
        errorCategory,
        attempt,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      if (attempt < maxRetries) {
        logger.warn(`Plan generation Claude call failed (attempt ${attempt}), collecting context for retry...`);
        await handleRetryContext(ctx, retryContext);
        continue;
      }

      throw new Error(`Plan generation failed after ${maxRetries} attempts: ${errorMessage}`);
    }

    try {
      const plan = extractJson<Plan>(result.output);
      validatePlan(plan);

      // 성공 기록
      retryContext.generationHistory.push({
        success: true,
        plan,
        attempt,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Plan generation succeeded on attempt ${attempt}`);
      return plan;
    } catch (parseError) {
      errorCategory = "UNKNOWN";
      errorMessage = parseError instanceof Error ? parseError.message : String(parseError);

      // 히스토리 기록
      retryContext.generationHistory.push({
        success: false,
        error: errorMessage,
        errorCategory,
        attempt,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      if (attempt < maxRetries) {
        logger.warn(`Plan JSON parsing failed (attempt ${attempt}), collecting context for retry...`);
        await handleRetryContext(ctx, retryContext);
        continue;
      }

      throw new Error(`Plan generation failed: JSON 파싱 실패 (${maxRetries}회 시도). Claude 응답: ${result.output.slice(0, 300)}`);
    }
  }

  throw new Error("Plan generation failed: unexpected exit");
}

/**
 * 이슈 본문에서 파일 경로를 추출합니다.
 */
function extractFilePathsFromIssue(issueBody: string): string[] {
  const filePaths: string[] = [];

  // 일반적인 파일 경로 패턴들
  const patterns = [
    // src/path/to/file.ts 형태
    /(?:^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-/]*\.[a-zA-Z0-9]+)(?:\s|$)/g,
    // `src/path/to/file.ts` 형태 (백틱으로 감싸진)
    /`([a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-/]*\.[a-zA-Z0-9]+)`/g,
    // ./src/path/to/file.ts 형태
    /(?:^|\s)(\.[/][a-zA-Z0-9_\-/]*\.[a-zA-Z0-9]+)(?:\s|$)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(issueBody)) !== null) {
      const filePath = match[1];
      // 중복 제거 및 유효성 검사
      if (!filePaths.includes(filePath) && isValidFilePath(filePath)) {
        filePaths.push(filePath);
      }
    }
  }

  return filePaths;
}

/**
 * 파일 경로가 유효한지 검사합니다.
 */
function isValidFilePath(filePath: string): boolean {
  // 기본적인 유효성 검사
  if (!filePath || filePath.length === 0) return false;
  if (filePath.includes('..')) return false; // 상위 디렉토리 접근 방지
  if (filePath.includes('//')) return false; // 이중 슬래시 방지

  // 프로그래밍 관련 파일 확장자 확인
  const validExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.toml'];
  return validExtensions.some(ext => filePath.endsWith(ext));
}

/**
 * 재시도 컨텍스트 처리: 컨텍스트 수집 및 이슈 코멘트 알림
 */
async function handleRetryContext(ctx: PlanGeneratorContext, retryContext: PlanRetryContext): Promise<void> {
  try {
    // 컨텍스트 수집
    logger.info("Collecting contextualization info for plan retry...");

    // 이슈 본문에서 파일 경로 추출
    const extractedFiles = extractFilePathsFromIssue(ctx.issue.body);

    const contextInfo = collectContextualizationInfo(extractedFiles, ctx.cwd);
    retryContext.contextualization = contextInfo;
    retryContext.lastFailureAt = new Date().toISOString();

    // 이슈 코멘트 알림
    logger.info(`Posting retry context comment to issue #${ctx.issue.number}`);
    const repo = `${ctx.repo.owner}/${ctx.repo.name}`;
    // retryContext의 deep copy를 전달하여 이후 수정으로부터 보호
    const retryContextSnapshot = JSON.parse(JSON.stringify(retryContext));
    await notifyPlanRetryContext(repo, ctx.issue.number, retryContextSnapshot, contextInfo);

    logger.info("Retry context collection and notification completed");
  } catch (contextError) {
    logger.warn(`Failed to collect retry context: ${contextError instanceof Error ? contextError.message : String(contextError)}`);
    // 컨텍스트 수집 실패는 치명적이지 않음, 재시도는 계속 진행
  }
}

function validatePlan(plan: Plan): void {
  if (!plan.phases || plan.phases.length === 0) {
    throw new Error("Plan must have at least one phase");
  }
  if (!plan.problemDefinition) {
    throw new Error("Plan must have a problem definition");
  }
  if (!plan.requirements || plan.requirements.length === 0) {
    throw new Error("Plan must have requirements");
  }
  // Ensure phases have indices and required array fields
  plan.phases.forEach((phase, i) => {
    phase.index = i;
    phase.targetFiles = phase.targetFiles ?? [];
    phase.verificationCriteria = phase.verificationCriteria ?? [];
    phase.dependsOn = phase.dependsOn ?? [];
  });
}

/**
 * Plan 생성 실패 시 관련 파일의 함수 시그니처와 import 관계를 수집한다.
 *
 * @param affectedFiles 영향받는 파일 경로 배열
 * @param cwd 작업 디렉토리
 * @returns 컨텍스트 정보
 */
export function collectContextualizationInfo(affectedFiles: string[], cwd: string): ContextualizationInfo {
  const functionSignatures: { [filePath: string]: string[] } = {};
  const importRelations: { [filePath: string]: { imports: string[]; exports: string[] } } = {};
  const typeDefinitions: { [filePath: string]: string[] } = {};

  for (const filePath of affectedFiles) {
    const fullPath = resolve(cwd, filePath);

    // 파일이 존재하고 TypeScript/JavaScript 파일인 경우만 처리
    if (!existsSync(fullPath) || !isTypeScriptOrJavaScriptFile(filePath)) {
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");

      functionSignatures[filePath] = extractFunctionSignatures(filePath, content);
      importRelations[filePath] = extractImportRelations(filePath, content);
      typeDefinitions[filePath] = extractTypeDefinitions(filePath, content);

      logger.debug(`Collected context for ${filePath}: ${functionSignatures[filePath].length} functions, ${importRelations[filePath].imports.length} imports, ${typeDefinitions[filePath].length} types`);
    } catch (error) {
      logger.warn(`Failed to collect context for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      // 실패한 파일은 빈 정보로 설정
      functionSignatures[filePath] = [];
      importRelations[filePath] = { imports: [], exports: [] };
      typeDefinitions[filePath] = [];
    }
  }

  return {
    functionSignatures,
    importRelations,
    typeDefinitions,
  };
}

/**
 * 파일이 TypeScript 또는 JavaScript 파일인지 확인
 */
function isTypeScriptOrJavaScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

/**
 * TypeScript AST를 사용하여 함수 시그니처를 추출
 */
function extractFunctionSignatures(filePath: string, content: string): string[] {
  const signatures: string[] = [];

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    visitNodeForSignatures(sourceFile, signatures);
  } catch (error) {
    // TypeScript 파싱 실패 시 정규식으로 폴백
    return extractFunctionSignaturesRegex(content);
  }

  return signatures;
}

/**
 * AST 노드를 순회하여 함수 시그니처 수집
 */
function visitNodeForSignatures(node: ts.Node, signatures: string[]): void {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const signature = getFunctionSignature(node);
    if (signature) {
      signatures.push(signature);
    }
  } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const signature = getMethodSignature(node);
    if (signature) {
      signatures.push(signature);
    }
  } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // 변수에 할당된 화살표 함수나 함수 표현식 처리
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.name && ts.isIdentifier(parent.name)) {
      const signature = `${parent.name.text}: ${node.getText().substring(0, 100)}...`;
      signatures.push(signature);
    }
  }

  ts.forEachChild(node, (child) => visitNodeForSignatures(child, signatures));
}

/**
 * TypeScript AST에서 함수 시그니처 추출
 */
function getFunctionSignature(node: ts.FunctionDeclaration): string | null {
  if (!node.name) return null;

  const name = node.name.text;
  const params = node.parameters.map(param => {
    const paramName = param.name.getText();
    const paramType = param.type ? param.type.getText() : 'any';
    return `${paramName}: ${paramType}`;
  }).join(', ');

  const returnType = node.type ? node.type.getText() : 'void';
  const asyncKeyword = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  const exportKeyword = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : '';

  return `${exportKeyword}${asyncKeyword}function ${name}(${params}): ${returnType}`;
}

/**
 * TypeScript AST에서 메소드 시그니처 추출
 */
function getMethodSignature(node: ts.MethodDeclaration | ts.MethodSignature): string | null {
  const name = node.name?.getText();
  if (!name) return null;

  const params = node.parameters.map(param => {
    const paramName = param.name.getText();
    const paramType = param.type ? param.type.getText() : 'any';
    return `${paramName}: ${paramType}`;
  }).join(', ');

  const returnType = node.type ? node.type.getText() : 'void';
  const asyncKeyword = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';

  return `${asyncKeyword}${name}(${params}): ${returnType}`;
}

/**
 * 정규식을 사용한 함수 시그니처 추출 (폴백)
 */
function extractFunctionSignaturesRegex(content: string): string[] {
  const signatures: string[] = [];

  // function 선언
  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g;
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    signatures.push(match[0]);
  }

  // 화살표 함수 (변수 할당)
  const arrowFunctionRegex = /(?:export\s+)?const\s+(\w+)\s*[:=]\s*(?:async\s+)?\([^)]*\)\s*=>/g;
  while ((match = arrowFunctionRegex.exec(content)) !== null) {
    signatures.push(match[0] + '...');
  }

  return signatures;
}

/**
 * Import/Export 관계 추출
 */
function extractImportRelations(filePath: string, content: string): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    visitNodeForImports(sourceFile, imports, exports);
  } catch (error) {
    // 파싱 실패 시 정규식으로 폴백
    return extractImportRelationsRegex(content);
  }

  return { imports, exports };
}

/**
 * AST 노드를 순회하여 import/export 관계 수집
 */
function visitNodeForImports(node: ts.Node, imports: string[], exports: string[]): void {
  if (ts.isImportDeclaration(node)) {
    const importText = node.getText();
    imports.push(importText);
  } else if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
    const exportText = node.getText();
    exports.push(exportText);
  } else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    // export 키워드가 있는 선언들
    const exportText = node.getText().substring(0, 100) + '...';
    exports.push(exportText);
  }

  ts.forEachChild(node, (child) => visitNodeForImports(child, imports, exports));
}

/**
 * 정규식을 사용한 Import/Export 관계 추출 (폴백)
 */
function extractImportRelationsRegex(content: string): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];

  // import 문 추출
  const importRegex = /import\s+.*?from\s+["'].*?["'];?/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[0]);
  }

  // export 문 추출
  const exportRegex = /export\s+.*?(?:[;}]|$)/gm;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[0]);
  }

  return { imports, exports };
}

/**
 * 타입 정의 추출
 */
function extractTypeDefinitions(filePath: string, content: string): string[] {
  const typeDefinitions: string[] = [];

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    visitNodeForTypes(sourceFile, typeDefinitions);
  } catch (error) {
    // 파싱 실패 시 정규식으로 폴백
    return extractTypeDefinitionsRegex(content);
  }

  return typeDefinitions;
}

/**
 * AST 노드를 순회하여 타입 정의 수집
 */
function visitNodeForTypes(node: ts.Node, typeDefinitions: string[]): void {
  if (ts.isTypeAliasDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isInterfaceDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isEnumDeclaration(node)) {
    typeDefinitions.push(node.getText());
  } else if (ts.isClassDeclaration(node)) {
    const className = node.name?.text || 'Unknown';
    const classSignature = `class ${className}${node.heritageClauses ? ' extends/implements...' : ''}`;
    typeDefinitions.push(classSignature);
  }

  ts.forEachChild(node, (child) => visitNodeForTypes(child, typeDefinitions));
}

/**
 * 정규식을 사용한 타입 정의 추출 (폴백)
 */
function extractTypeDefinitionsRegex(content: string): string[] {
  const typeDefinitions: string[] = [];

  // interface 정의
  const interfaceRegex = /(?:export\s+)?interface\s+\w+\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\s*\{[^}]*\}/gs;
  let match;
  while ((match = interfaceRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }

  // type 정의
  const typeRegex = /(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;?/g;
  while ((match = typeRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }

  // enum 정의
  const enumRegex = /(?:export\s+)?enum\s+\w+\s*\{[^}]*\}/gs;
  while ((match = enumRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0]);
  }

  // class 정의
  const classRegex = /(?:export\s+)?class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[^{]*)?\s*\{/g;
  while ((match = classRegex.exec(content)) !== null) {
    typeDefinitions.push(match[0] + '...}');
  }

  return typeDefinitions;
}
