/**
 * 프롬프트 레이어 타입 정의
 *
 * 5계층 구조:
 *   BaseLayer    — 역할·규칙 등 완전 정적 (글로벌 캐시)
 *   ProjectLayer — 프로젝트 수준 설정 (프로젝트별 캐시)
 *   IssueLayer   — 이슈 정보 (이슈번호별 캐시)
 *   PhaseLayer   — 현재 Phase 실행 컨텍스트 (Phase별 캐시)
 *   LearningLayer— 누적 학습 정보 (동적, 주기적 갱신)
 */

// ---------------------------------------------------------------------------
// BaseLayer
// 캐시 특성: 완전 정적. 내용이 바뀌지 않는 한 영구 캐시 가능.
//             캐시 키: role + rules 해시
// ---------------------------------------------------------------------------

/**
 * 기본 레이어 — AI 역할 정의, 보편적 규칙, 출력 형식 등 프로젝트와 무관한 정적 내용.
 */
export interface BaseLayer {
  /** AI 역할 정의 (예: "시니어 개발자") */
  role: string;
  /** 보편적 규칙 및 지침 목록 */
  rules: string[];
  /** 출력 포맷 지침 */
  outputFormat: string;
  /** 진행 보고 규칙 */
  progressReporting: string;
  /** 병렬 작업 가이드 */
  parallelWorkGuide: string;
}

// ---------------------------------------------------------------------------
// ProjectLayer
// 캐시 특성: 프로젝트 루트 경로 + conventions 해시 기반 캐시.
//             CLAUDE.md 변경 시 무효화.
// ---------------------------------------------------------------------------

/**
 * 프로젝트 레이어 — 프로젝트별 컨벤션, 구조, 명령어 등 준-정적 내용.
 */
export interface ProjectLayer {
  /** 프로젝트 컨벤션 (CLAUDE.md 내용) */
  conventions: string;
  /** 프로젝트 디렉토리 구조 요약 */
  structure: string;
  /** 스킬 컨텍스트 (선택) */
  skillsContext?: string;
  /** 테스트 실행 명령어 */
  testCommand: string;
  /** 린트 실행 명령어 */
  lintCommand: string;
  /** 프로젝트 특정 안전 규칙 목록 */
  safetyRules: string[];
}

// ---------------------------------------------------------------------------
// IssueLayer
// 캐시 특성: 이슈 번호 + repo 조합 키로 캐시.
//             이슈 본문이 수정되면 무효화.
// ---------------------------------------------------------------------------

/**
 * 이슈 레이어 — GitHub 이슈 정보 및 저장소 메타데이터.
 * PhaseLayer에서 분리하여 이슈별 캐시를 독립적으로 관리한다.
 */
export interface IssueLayer {
  /** 이슈 번호 */
  number: number;
  /** 이슈 제목 */
  title: string;
  /** 이슈 본문 */
  body: string;
  /** 이슈 라벨 목록 */
  labels: string[];
  /** 저장소 정보 */
  repository: {
    owner: string;
    name: string;
    baseBranch: string;
    workBranch: string;
  };
  /** 전체 계획 요약 */
  planSummary: string;
}

// ---------------------------------------------------------------------------
// PhaseLayer
// 캐시 특성: 캐시하지 않음(매 Phase 실행마다 새로 생성).
//             이전 Phase 결과가 포함되어 있어 항상 동적.
// ---------------------------------------------------------------------------

/**
 * Phase 레이어 — 현재 실행 중인 Phase의 컨텍스트. 매 Phase마다 동적으로 생성된다.
 */
export interface PhaseLayer {
  /** 현재 Phase 정보 */
  currentPhase: {
    /** 1-based Phase 인덱스 */
    index: number;
    /** 전체 Phase 수 */
    totalCount: number;
    /** Phase 이름 */
    name: string;
    /** Phase 상세 설명 */
    description: string;
    /** 이 Phase에서 다뤄야 할 대상 파일 목록 */
    targetFiles: string[];
  };
  /** 이전 Phase 결과 요약 (없으면 빈 문자열) */
  previousResults: string;
  /** 로케일 (선택, 기본값 ko) */
  locale?: string;
}

// ---------------------------------------------------------------------------
// LearningLayer
// 캐시 특성: 프로젝트 루트 + 이슈 번호 조합 키로 캐시.
//             실패/성공 이벤트 발생 시 점진적으로 갱신됨.
// ---------------------------------------------------------------------------

/**
 * 학습 레이어 — 과거 실패 사례, 에러 패턴, 학습된 베스트 프랙티스.
 * 파이프라인 실행이 누적될수록 내용이 풍부해진다.
 */
export interface LearningLayer {
  /** 과거 실패 사례 목록 */
  pastFailures: Array<{
    /** 실패가 발생한 Phase 또는 컨텍스트 설명 */
    context: string;
    /** 실패 메시지 요약 */
    message: string;
    /** 해결 방법 (알려진 경우) */
    resolution?: string;
  }>;
  /** 반복적으로 관찰된 에러 패턴 */
  errorPatterns: string[];
  /** 축적된 베스트 프랙티스 */
  learnedPatterns: string[];
  /** 마지막 갱신 시각 (ISO 8601) */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// CacheKeyConfig
// ---------------------------------------------------------------------------

/**
 * 각 레이어의 캐시 키 계산에 필요한 입력값 구성.
 */
export interface CacheKeyConfig {
  /** BaseLayer 캐시 키 재료 */
  base: {
    /** BaseLayer.role 값 */
    role: string;
    /** BaseLayer.rules를 직렬화한 문자열 */
    rulesDigest: string;
  };
  /** ProjectLayer 캐시 키 재료 */
  project: {
    /** 프로젝트 루트 절대 경로 */
    projectRoot: string;
    /** ProjectLayer.conventions 해시 */
    conventionsDigest: string;
  };
  /** IssueLayer 캐시 키 재료 */
  issue: {
    /** 저장소 식별자 (owner/repo) */
    repo: string;
    /** 이슈 번호 */
    issueNumber: number;
    /** IssueLayer.body 해시 (본문 변경 감지용) */
    bodyDigest: string;
  };
  /** LearningLayer 캐시 키 재료 */
  learning: {
    /** 저장소 식별자 (owner/repo) */
    repo: string;
    /** 이슈 번호 */
    issueNumber: number;
    /** LearningLayer.updatedAt 값 */
    updatedAt: string;
  };
  // PhaseLayer는 캐시하지 않으므로 포함하지 않음
}

// ---------------------------------------------------------------------------
// PromptLayers
// ---------------------------------------------------------------------------

/**
 * 5계층 프롬프트 레이어를 모두 포함하는 인터페이스.
 */
export interface PromptLayers {
  /** 기본 레이어 (완전 정적, 글로벌 캐시) */
  base: BaseLayer;
  /** 프로젝트 레이어 (프로젝트별 캐시) */
  project: ProjectLayer;
  /** 이슈 레이어 (이슈별 캐시) */
  issue: IssueLayer;
  /** Phase 레이어 (캐시 없음, 매번 동적 생성) */
  phase: PhaseLayer;
  /** 학습 레이어 (점진적 갱신, 주기적 캐시) */
  learning: LearningLayer;
}
