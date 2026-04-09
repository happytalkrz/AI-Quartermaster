export interface ManagedSourceOptions {
  // 향후 관리형 config 로딩을 위한 옵션들
  // 예: managedConfigUrl?: string;
}

export interface ManagedSourceResult {
  config: Record<string, unknown>;
  error?: {
    type: 'not_found' | 'network' | 'validation';
    message: string;
  };
}

/**
 * 관리형 config 로딩 (향후 구현 예정)
 * 예: 중앙 서버나 관리 시스템에서 config 가져오기
 * 현재는 빈 config를 반환
 */
export function loadManagedSource(options: ManagedSourceOptions = {}): ManagedSourceResult {
  // TODO: 관리형 config 로딩 구현
  // 예: 중앙 서버에서 config 다운로드, 조직별 정책 적용 등
  return { config: {} };
}