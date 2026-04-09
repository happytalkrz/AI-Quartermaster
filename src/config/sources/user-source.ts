export interface UserSourceOptions {
  // 향후 사용자별 config 로딩을 위한 옵션들
  // 예: userConfigPath?: string;
}

export interface UserSourceResult {
  config: Record<string, unknown>;
  error?: {
    type: 'not_found' | 'yaml_syntax' | 'validation';
    message: string;
  };
}

/**
 * 사용자별 config 로딩 (향후 구현 예정)
 * 현재는 빈 config를 반환
 */
export function loadUserSource(options: UserSourceOptions = {}): UserSourceResult {
  // TODO: 사용자별 설정 파일 로딩 구현
  // 예: ~/.aqm/config.yml 또는 사용자별 설정
  return { config: {} };
}