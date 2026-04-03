import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import * as ts from "typescript";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import type { Plan, ContextualizationInfo } from "../types/pipeline.js";
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
  const templatePath = resolve(ctx.promptsDir, "plan-generation.md");
  const template = loadTemplate(templatePath);

  const sanitizedBody = `<USER_INPUT>\n${ctx.issue.body}\n</USER_INPUT>`;

  const rendered = renderTemplate(template, {
    issue: {
      number: String(ctx.issue.number),
      title: ctx.issue.title,
      body: sanitizedBody,
      labels: ctx.issue.labels,
    },
    repo: {
      owner: ctx.repo.owner,
      name: ctx.repo.name,
      structure: ctx.repoStructure,
    },
    branch: ctx.branch,
    config: {
      maxPhases: String(ctx.maxPhases ?? 10),
      sensitivePaths: ctx.sensitivePaths ?? "",
    },
  });

  let finalPrompt = rendered;
  if (ctx.modeHint) {
    finalPrompt += `\n\n## 추가 지시\n\n${ctx.modeHint}`;
  }

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

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Sending plan generation prompt (${finalPrompt.length} chars)${attempt > 1 ? ` [retry ${attempt}/${maxRetries}]` : ""}`);

    const result = await runClaude({
      prompt: finalPrompt,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "plan"),
      jsonSchema: planSchema,
      enableAgents: true,
    });

    if (!result.success) {
      if (attempt < maxRetries) {
        logger.warn(`Plan generation Claude call failed (attempt ${attempt}), retrying...`);
        continue;
      }
      throw new Error(`Plan generation failed after ${maxRetries} attempts: ${result.output.slice(0, 200)}`);
    }

    try {
      const plan = extractJson<Plan>(result.output);
      validatePlan(plan);
      return plan;
    } catch (parseError) {
      if (attempt < maxRetries) {
        logger.warn(`Plan JSON parsing failed (attempt ${attempt}), retrying... Output preview: ${result.output.slice(0, 100)}`);
        continue;
      }
      throw new Error(`Plan generation failed: JSON 파싱 실패 (${maxRetries}회 시도). Claude 응답: ${result.output.slice(0, 300)}`);
    }
  }

  throw new Error("Plan generation failed: unexpected exit");
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

    function visit(node: ts.Node) {
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

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  } catch (error) {
    // TypeScript 파싱 실패 시 정규식으로 폴백
    return extractFunctionSignaturesRegex(content);
  }

  return signatures;
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

    function visit(node: ts.Node) {
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

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  } catch (error) {
    // 파싱 실패 시 정규식으로 폴백
    return extractImportRelationsRegex(content);
  }

  return { imports, exports };
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

    function visit(node: ts.Node) {
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

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  } catch (error) {
    // 파싱 실패 시 정규식으로 폴백
    return extractTypeDefinitionsRegex(content);
  }

  return typeDefinitions;
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
