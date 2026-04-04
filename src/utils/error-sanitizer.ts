/**
 * 에러 메시지에서 민감 정보를 제거하는 유틸리티
 * OWASP 보안 기준에 따라 stderr/stdout에서 민감 정보 노출을 방지
 */

/**
 * 에러 메시지에서 민감 정보를 sanitize
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return 'An error occurred';
  }

  let sanitized = message;

  // 긴 줄 제한 먼저 적용 (200자 이상)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 197) + '...';
  }

  // GitHub 토큰 (ghp_, gho_, ghu_, ghs_, ghr_)
  sanitized = sanitized.replace(/gh[pous]_[A-Za-z0-9_]{36}/g, '[REDACTED]');

  // 토큰/키 패턴 (토큰 뒤의 값만 제거)
  sanitized = sanitized.replace(/(\b(?:token|key|password|secret|auth)\s*[=:]\s*)([^\s\n]{8,})/gi, '$1[REDACTED]');

  // 파일 시스템 경로 (홈 디렉토리)
  sanitized = sanitized.replace(/\/home\/[^\/\s]+/g, '[REDACTED]');

  // 이메일 주소
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]');

  // IP 주소
  sanitized = sanitized.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, '[REDACTED]');

  // URL (https://)
  sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[REDACTED]');

  // 긴 해시값 (8자 이상의 연속된 hex)
  sanitized = sanitized.replace(/\b[a-fA-F0-9]{8,}\b/g, '[HASH]');

  // 빈 문자열인 경우 기본 메시지
  if (!sanitized.trim()) {
    return 'Operation failed';
  }

  return sanitized;
}

/**
 * CLI 실행 결과에서 안전한 에러 메시지 추출
 */
export function sanitizeCliError(stderr: string, stdout: string = '', fallback: string = 'Command failed'): string {
  // stderr 우선, 없으면 stdout, 둘 다 없으면 fallback
  const rawError = stderr || stdout || fallback;
  return sanitizeErrorMessage(rawError);
}

/**
 * Git 명령 에러를 사용자 친화적으로 변환
 */
export function sanitizeGitError(stderr: string, operation: string): string {
  if (!stderr || typeof stderr !== 'string') {
    return `Git ${operation} failed`;
  }

  // Git 에러 패턴별 친화적 메시지
  if (stderr.includes('Permission denied')) {
    return `Git ${operation} failed: Permission denied`;
  }
  if (stderr.includes('fatal: not a git repository')) {
    return `Git ${operation} failed: Not a git repository`;
  }
  if (stderr.includes('fatal: remote')) {
    return `Git ${operation} failed: Remote repository issue`;
  }
  if (stderr.includes('error: failed to push')) {
    return `Git ${operation} failed: Push rejected`;
  }
  if (stderr.includes('CONFLICT')) {
    return `Git ${operation} failed: Merge conflict detected`;
  }

  // 일반적인 sanitize 적용
  const sanitized = sanitizeErrorMessage(stderr);
  return `Git ${operation} failed: ${sanitized}`;
}

/**
 * GitHub CLI 에러를 사용자 친화적으로 변환
 */
export function sanitizeGhError(stderr: string, stdout: string = '', operation: string): string {
  const rawError = stderr || stdout;

  if (!rawError || typeof rawError !== 'string') {
    return `GitHub ${operation} failed`;
  }

  // GitHub CLI 에러 패턴별 친화적 메시지
  if (rawError.includes('authentication required') || rawError.includes('HTTP 401')) {
    return `GitHub ${operation} failed: Authentication required`;
  }
  if (rawError.includes('not found') || rawError.includes('HTTP 404')) {
    return `GitHub ${operation} failed: Resource not found`;
  }
  if (rawError.includes('rate limit') || rawError.includes('HTTP 429')) {
    return `GitHub ${operation} failed: Rate limit exceeded`;
  }
  if (rawError.includes('HTTP 403')) {
    return `GitHub ${operation} failed: Permission denied`;
  }

  // 일반적인 sanitize 적용
  const sanitized = sanitizeErrorMessage(rawError);
  return `GitHub ${operation} failed: ${sanitized}`;
}