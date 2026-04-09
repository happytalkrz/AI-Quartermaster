import { readFileSync, existsSync, writeFileSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AQConfig, ProjectConfig, InitCommandOptions } from "../types/config.js";
import { validateConfig } from "./validator.js";
import { ManagedSource } from "./sources/managed-source.js";
import { UserSource } from "./sources/user-source.js";
import { ProjectSource } from "./sources/project-source.js";
import { CliSource } from "./sources/cli-source.js";
import { EnvSource } from "./sources/env-source.js";
import type { ConfigSources } from "./sources/types.js";
import { SOURCE_PRIORITY_ORDER } from "./sources/types.js";

export interface TryLoadConfigResult {
  config: AQConfig | null;
  error?: {
    type: 'not_found' | 'yaml_syntax' | 'validation';
    message: string;
    details?: string[];
  };
}

/**
 * YAML 에러 객체가 code 프로퍼티를 가지는지 확인하는 타입 가드
 */
function hasErrorCode(error: Error): error is Error & { code: string } {
  return 'code' in error && typeof (error as Error & { code: unknown }).code === 'string';
}

/**
 * YAML 탭 문자 에러를 사용자 친화적인 메시지로 변환
 */
function formatYamlTabError(error: unknown, filePath: string): Error {
  if (error instanceof Error &&
      error.constructor.name === 'YAMLParseError' &&
      hasErrorCode(error) &&
      error.code === 'TAB_AS_INDENT') {
    const lineMatch = error.message.match(/line (\d+)/);
    const lineNumber = lineMatch?.[1] ?? '?';

    const friendlyMessage = `❌ YAML 설정 파일에 탭 문자가 포함되어 있습니다.
   파일: ${filePath}
   위치: ${lineNumber}번째 줄

   해결방법: YAML 파일에서는 들여쓰기에 탭 문자를 사용할 수 없습니다. 탭 문자를 스페이스(공백)로 교체해주세요.

   예시:
   # 잘못된 예 (탭 문자 사용)
   general:
   →→projectName: "my-project"

   # 올바른 예 (스페이스 사용)
   general:
     projectName: "my-project"

   팁: 에디터에서 "공백 표시" 기능을 활성화하면 탭 문자와 스페이스를 구분할 수 있습니다.`;

    return new Error(friendlyMessage);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * YAML 파싱을 수행하되 탭 문자 에러를 친절하게 처리
 */
export function parseYamlSafely(content: string, filePath: string): unknown {
  try {
    return parseYaml(content);
  } catch (error: unknown) {
    throw formatYamlTabError(error, filePath);
  }
}

/**
 * 타입 가드: 값이 Record<string, unknown>인지 확인
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
         typeof value === "object" &&
         !Array.isArray(value);
}

// Deep merge helper - recursively merges source into target
// Arrays in source replace arrays in target (no concat)
export function deepMerge<T = Record<string, unknown>>(target: unknown, source: unknown): T {
  if (source === null || source === undefined) {
    return target as T;
  }
  if (!isRecord(source)) {
    return source as T;
  }
  if (!isRecord(target)) {
    return source as T;
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = deepMerge(target[key], source[key]);
  }
  return result as T;
}

export interface LoadConfigOptions {
  envVars?: Record<string, string | undefined>;
  configOverrides?: Record<string, unknown>;
}

// Overloaded function signatures
export function loadConfig(projectRoot: string): AQConfig;
export function loadConfig(projectRoot: string, options: LoadConfigOptions): AQConfig;
export function loadConfig(projectRoot: string, options?: LoadConfigOptions): AQConfig {
  const sources: ConfigSources = {
    managed: new ManagedSource(),
    user: new UserSource(),
    project: new ProjectSource(projectRoot),
  };

  if (options?.configOverrides) {
    sources.cli = new CliSource(options.configOverrides);
  }

  if (options?.envVars !== undefined) {
    sources.env = new EnvSource(options.envVars);
  }

  let merged: Record<string, unknown> = {};
  for (const name of SOURCE_PRIORITY_ORDER) {
    const source = sources[name];
    if (!source) continue;
    merged = deepMerge(merged, source.load() as Record<string, unknown>);
  }

  return validateConfig(merged);
}

// Overloaded function signatures for tryLoadConfig
export function tryLoadConfig(projectRoot: string): TryLoadConfigResult;
export function tryLoadConfig(projectRoot: string, options: LoadConfigOptions): TryLoadConfigResult;
export function tryLoadConfig(projectRoot: string, options?: LoadConfigOptions): TryLoadConfigResult {
  const baseConfigPath = `${projectRoot}/config.yml`;

  // Check if base config exists
  if (!existsSync(baseConfigPath)) {
    return {
      config: null,
      error: {
        type: 'not_found',
        message: `config.yml not found at ${baseConfigPath}`
      }
    };
  }

  const sources: ConfigSources = {
    managed: new ManagedSource(),
    user: new UserSource(),
    project: new ProjectSource(projectRoot),
  };

  if (options?.configOverrides) {
    sources.cli = new CliSource(options.configOverrides);
  }

  if (options?.envVars !== undefined) {
    sources.env = new EnvSource(options.envVars);
  }

  let merged: Record<string, unknown> = {};

  for (const name of SOURCE_PRIORITY_ORDER) {
    const source = sources[name];
    if (!source) continue;
    try {
      merged = deepMerge(merged, source.load() as Record<string, unknown>);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        config: null,
        error: {
          type: name === 'project' ? 'yaml_syntax' : 'validation',
          message
        }
      };
    }
  }

  // Try to validate config
  try {
    const validatedConfig = validateConfig(merged);
    return { config: validatedConfig };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown validation error';
    const lines = message.split('\n');
    const details = lines.length > 1
      ? lines.slice(1).filter(line => line.trim())
      : undefined;

    return {
      config: null,
      error: {
        type: 'validation',
        message: lines[0] || 'Validation failed',
        details: details?.length ? details : undefined
      }
    };
  }
}

/**
 * GitHub URL에서 owner/repo 추출
 */
function extractRepoFromUrl(url: string): string | undefined {
  const patterns = [
    /git@github\.com:(.+?)\.git$/,
    /https:\/\/github\.com\/(.+?)\.git$/,
    /https:\/\/github\.com\/(.+?)$/
  ];
  return patterns.reduce((match, pattern) => match || url.match(pattern)?.[1], undefined as string | undefined);
}

/**
 * Git 정보를 현재 디렉토리에서 자동 감지
 */
export async function detectGitInfo(cwd: string): Promise<{ repo?: string; baseBranch?: string; error?: string }> {
  try {
    const { runCli } = await import("../utils/cli-runner.js");

    // 1. git remote에서 repo 감지
    let repo: string | undefined;
    try {
      const remoteResult = await runCli("git", ["remote", "get-url", "origin"], { cwd, timeout: 5000 });
      if (remoteResult.exitCode === 0) {
        repo = extractRepoFromUrl(remoteResult.stdout.trim());
      }
    } catch {
      // git remote 실패 - repo는 undefined로 남김
    }

    // 2. 기본 브랜치 감지
    let baseBranch: string | undefined;
    try {
      const branchResult = await runCli("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd, timeout: 5000 });
      if (branchResult.exitCode === 0) {
        baseBranch = branchResult.stdout.trim().split('/').pop();
      }
    } catch {
      // symbolic-ref 실패 시 git config에서 확인
      try {
        const configResult = await runCli("git", ["config", "init.defaultBranch"], { cwd, timeout: 5000 });
        if (configResult.exitCode === 0) {
          baseBranch = configResult.stdout.trim();
        }
      } catch {
        baseBranch = "main";
      }
    }

    return { repo, baseBranch };
  } catch (error: unknown) {
    return { error: `Git 정보 감지 실패: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 최소한의 config.yml 파일 생성
 */
export function writeMinimalConfig(configPath: string, project: ProjectConfig): void {
  const projectLines = [
    `  - repo: "${project.repo}"`,
    `    path: "${project.path}"`
  ];
  if (project.baseBranch) projectLines.push(`    baseBranch: "${project.baseBranch}"`);
  if (project.mode) projectLines.push(`    mode: "${project.mode}"`);

  const content = `# AI Quartermaster 설정 파일
# 전체 옵션은 https://github.com/your-repo/ai-quartermaster/blob/main/docs/config-schema.md 참조

projects:
${projectLines.join('\n')}

# 추가 설정이 필요한 경우 아래 섹션들을 참고하여 추가하세요
# general:
#   projectName: "my-project"
#   logLevel: "info"
#   concurrency: 1
#
# safety:
#   allowedLabels: ["enhancement", "bug"]
#   maxPhases: 10
`;

  writeFileSync(configPath, content, 'utf-8');
}

/**
 * 프로젝트 정보를 YAML 라인으로 변환
 */
function buildProjectLines(indent: string, project: ProjectConfig): string[] {
  const lines = [
    `${indent}- repo: "${project.repo}"`,
    `${indent}  path: "${project.path}"`
  ];
  if (project.baseBranch) lines.push(`${indent}  baseBranch: "${project.baseBranch}"`);
  if (project.mode) lines.push(`${indent}  mode: "${project.mode}"`);
  return lines;
}

/**
 * 기존 config.yml에 프로젝트 추가 (YAML 포맷 보존)
 */
export function addProjectToConfig(configPath: string, project: ProjectConfig): void {
  const content = readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');

  // projects 섹션 찾기
  const projectsIndex = lines.findIndex(line => line.match(/^(\s*)projects\s*:\s*$/));

  if (projectsIndex === -1) {
    // projects 섹션이 없으면 파일 끝에 추가
    const projectLines = buildProjectLines('  ', project);
    const newContent = content.trim() + '\n\nprojects:\n' + projectLines.join('\n') + '\n';
    writeFileSync(configPath, newContent, 'utf-8');
    return;
  }

  // 기존 프로젝트 항목 뒤에 추가할 위치 찾기
  const projectsIndent = lines[projectsIndex].match(/^(\s*)/)![1];
  const itemIndent = projectsIndent + '  ';
  let insertIndex = projectsIndex + 1;

  for (let i = projectsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const isBlanK = line.trim() === '';
    const isProjectItem = line.startsWith(itemIndent);
    const isNewSection = !isProjectItem && line.match(/^\s*\w+\s*:/);

    if (isBlanK) continue;
    if (isNewSection) break;
    insertIndex = i + 1;
  }

  const newProjectLines = buildProjectLines(itemIndent, project);
  lines.splice(insertIndex, 0, ...newProjectLines);
  writeFileSync(configPath, lines.join('\n'), 'utf-8');
}

export function removeProjectFromConfig(configPath: string, targetRepo: string): void {
  const content = readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');

  const projectsIndex = lines.findIndex(line => line.match(/^(\s*)projects\s*:\s*$/));

  if (projectsIndex === -1) {
    return;
  }

  const projectsIndent = lines[projectsIndex].match(/^(\s*)/)![1];
  const itemIndent = projectsIndent + '  ';
  let removeStartIndex = -1;
  let removeEndIndex = -1;

  for (let i = projectsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine === '') continue;

    if (!line.startsWith(itemIndent) && trimmedLine.match(/^\w+\s*:/)) {
      break;
    }

    if (line.startsWith(itemIndent) && line.includes('- repo:')) {
      const repoMatch = line.match(/- repo:\s*["'](.+?)["']/);
      if (repoMatch && repoMatch[1] === targetRepo) {
        removeStartIndex = i;
        removeEndIndex = i;

        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();

          if (nextTrimmed === '') continue;

          if (nextLine.startsWith(itemIndent) && nextLine.includes('- repo:')) {
            break;
          }

          if (!nextLine.startsWith(itemIndent) && nextTrimmed.match(/^\w+\s*:/)) {
            break;
          }

          if (nextLine.startsWith(itemIndent + '  ')) {
            removeEndIndex = j;
          } else {
            break;
          }
        }
        break;
      }
    }
  }

  if (removeStartIndex !== -1 && removeEndIndex !== -1) {
    lines.splice(removeStartIndex, removeEndIndex - removeStartIndex + 1);
    writeFileSync(configPath, lines.join('\n'), 'utf-8');
  }
}

/**
 * 기존 config.yml에서 프로젝트 업데이트 (YAML 포맷 보존)
 */
export function updateProjectInConfig(configPath: string, targetRepo: string, updates: Partial<Pick<ProjectConfig, 'path' | 'baseBranch' | 'mode'>>): void {
  const content = readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');

  const projectsIndex = lines.findIndex(line => line.match(/^(\s*)projects\s*:\s*$/));
  if (projectsIndex === -1) {
    throw new Error(`No projects section found in config`);
  }

  const indent = lines[projectsIndex].match(/^(\s*)/)![1];
  const itemIndent = indent + '  ';
  const fieldIndent = itemIndent + '  ';

  let projectStart = -1;
  let projectEnd = -1;

  // Find target project
  for (let i = projectsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') continue;
    if (!line.startsWith(itemIndent) && trimmed.match(/^\w+\s*:/)) break;

    if (line.startsWith(itemIndent) && line.includes('- repo:')) {
      const match = line.match(/- repo:\s*["'](.+?)["']/);
      if (match?.[1] !== targetRepo) continue;

      projectStart = i;
      projectEnd = i;

      // Find project end
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();

        if (nextTrimmed === '') continue;
        if (nextLine.startsWith(itemIndent) && nextLine.includes('- repo:')) break;
        if (!nextLine.startsWith(itemIndent) && nextTrimmed.match(/^\w+\s*:/)) break;

        if (nextLine.startsWith(fieldIndent)) {
          projectEnd = j;
        } else {
          break;
        }
      }
      break;
    }
  }

  if (projectStart === -1) {
    throw new Error(`Project "${targetRepo}" not found in config`);
  }

  const projectLines = lines.slice(projectStart, projectEnd + 1);

  // Update or add fields
  Object.entries(updates).forEach(([field, value]) => {
    if (value === undefined) return;

    const fieldLineIndex = projectLines.findIndex((line, i) => i > 0 && line.includes(`${field}:`));

    if (fieldLineIndex !== -1) {
      projectLines[fieldLineIndex] = `${fieldIndent}${field}: "${value}"`;
    } else {
      projectLines.splice(1, 0, `${fieldIndent}${field}: "${value}"`);
    }
  });

  lines.splice(projectStart, projectEnd - projectStart + 1, ...projectLines);
  writeFileSync(configPath, lines.join('\n'), 'utf-8');
}

/**
 * 현재 프로젝트를 config.yml에 등록
 */
export async function initProject(aqRoot: string, options: InitCommandOptions = {}): Promise<void> {
  const configPath = `${aqRoot}/config.yml`;
  const cwd = process.cwd();

  // 1. Git 정보 자동 감지
  const gitInfo = await detectGitInfo(cwd);
  if (gitInfo.error) {
    throw new Error(gitInfo.error);
  }

  // 2. 프로젝트 정보 구성
  const project: ProjectConfig = {
    repo: options.repo || gitInfo.repo || '',
    path: options.path || cwd,
    baseBranch: options.baseBranch || gitInfo.baseBranch,
    mode: options.mode,
  };

  if (!project.repo) {
    throw new Error('GitHub 저장소를 감지할 수 없습니다. --repo 옵션으로 명시하거나 git remote가 설정되어 있는지 확인하세요.');
  }

  // 3. 기존 config.yml 확인
  if (existsSync(configPath)) {
    // 기존 설정 로드해서 중복 검사
    try {
      const currentConfig = loadConfig(aqRoot);
      const existingProject = currentConfig.projects?.find(p => p.repo === project.repo);

      if (existingProject && !options.force) {
        throw new Error(`프로젝트 "${project.repo}"가 이미 등록되어 있습니다. --force 옵션으로 덮어쓸 수 있습니다.`);
      }

      if (existingProject && options.force) {
        // 기존 프로젝트 제거 후 추가하는 것보다는, 단순히 덮어쓰기
        // 여기서는 단순히 추가만 구현 (제거 로직은 Phase 2에서)
        console.log(`기존 프로젝트 "${project.repo}" 설정을 덮어씁니다.`);
      }

      addProjectToConfig(configPath, project);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('config.yml not found')) {
        // loadConfig 실패 시 파일은 있지만 유효하지 않음
        throw new Error('config.yml 파일이 손상되었습니다. 수동으로 수정하거나 백업 후 다시 생성하세요.');
      }
      throw error;
    }
  } else {
    // 4. 새 config.yml 생성
    writeMinimalConfig(configPath, project);
  }
}

/**
 * Config 섹션 업데이트 및 저장 (partial update 지원)
 * @param projectRoot - 프로젝트 루트 경로
 * @param updates - 업데이트할 config 섹션들
 */
export function updateConfigSection(projectRoot: string, updates: Partial<AQConfig>): void {
  const configPath = `${projectRoot}/config.yml`;

  if (!existsSync(configPath)) {
    throw new Error(`config.yml not found at ${configPath}`);
  }

  const currentRaw = parseYamlSafely(readFileSync(configPath, "utf-8"), configPath);
  const updatedConfig = deepMerge(currentRaw, updates);
  const validatedConfig = validateConfig(updatedConfig);
  const yamlContent = stringifyYaml(validatedConfig);

  writeFileSync(configPath, yamlContent, 'utf-8');
}
