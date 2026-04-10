/**
 * AQM Task 공통 인터페이스 정의
 * Claude, Codex, Gemini 등 다양한 태스크 타입을 통합 관리하기 위한 추상화
 */

/**
 * 태스크 실행 상태
 */
export enum TaskStatus {
  /** 태스크가 생성되었으나 아직 실행되지 않은 상태 */
  PENDING = "PENDING",
  /** 태스크가 현재 실행 중인 상태 */
  RUNNING = "RUNNING",
  /** 태스크가 성공적으로 완료된 상태 */
  SUCCESS = "SUCCESS",
  /** 태스크 실행 중 오류가 발생한 상태 */
  FAILED = "FAILED",
  /** 태스크가 외부에서 강제 종료된 상태 */
  KILLED = "KILLED"
}

/**
 * 지원하는 태스크 타입
 * 향후 CodexTask, GeminiTask 등 확장 가능
 */
export type AQMTaskType = "claude" | "codex" | "gemini" | "validation";

/**
 * 태스크 라이프사이클 이벤트 타입
 */
export type TaskLifecycleEvent = "started" | "completed" | "failed" | "killed";

/**
 * 태스크 이벤트 리스너 타입
 */
export type TaskEventListener = () => void;

/**
 * 태스크 이벤트 에미터 인터페이스
 * 라이프사이클 이벤트를 구독/해제하는 메서드 계약
 */
export interface TaskEventEmitter {
  on(event: TaskLifecycleEvent, listener: TaskEventListener): void;
  off(event: TaskLifecycleEvent, listener: TaskEventListener): void;
  once(event: TaskLifecycleEvent, listener: TaskEventListener): void;
}

/**
 * 태스크 JSON 직렬화를 위한 요약 정보
 */
export interface AQMTaskSummary {
  /** 태스크 고유 식별자 */
  id: string;
  /** 태스크 타입 */
  type: AQMTaskType;
  /** 현재 실행 상태 */
  status: TaskStatus;
  /** 태스크 시작 시각 (ISO string) */
  startedAt?: string;
  /** 태스크 완료 시각 (ISO string) */
  completedAt?: string;
  /** 실행 소요 시간 (밀리초) */
  durationMs?: number;
  /** 실행 결과 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 태스크 역직렬화(fromJSON)를 위한 직렬화 형태
 * AQMTaskSummary와 동일한 구조이나, 역직렬화 목적으로 분리
 */
export type SerializedTask = AQMTaskSummary;

/**
 * AQM 태스크 공통 인터페이스
 * 모든 태스크 구현체가 따라야 하는 계약을 정의
 */
export interface AQMTask {
  /** 태스크 고유 식별자 (읽기 전용) */
  readonly id: string;

  /** 태스크 타입 (읽기 전용) */
  readonly type: AQMTaskType;

  /** 현재 태스크 실행 상태 */
  get status(): TaskStatus;

  /**
   * 실행 중인 태스크를 강제 종료
   * @returns Promise that resolves when the task is killed
   */
  kill(): Promise<void>;

  /**
   * 태스크 정보를 JSON 직렬화 가능한 형태로 변환
   * @returns 직렬화된 태스크 요약 정보
   */
  toJSON(): AQMTaskSummary;

  /**
   * 라이프사이클 이벤트 리스너 등록
   */
  on?(event: TaskLifecycleEvent, listener: TaskEventListener): void;

  /**
   * 라이프사이클 이벤트 리스너 해제
   */
  off?(event: TaskLifecycleEvent, listener: TaskEventListener): void;

  /**
   * 라이프사이클 이벤트 리스너 1회 등록 (이벤트 발생 후 자동 해제)
   */
  once?(event: TaskLifecycleEvent, listener: TaskEventListener): void;
}

/**
 * 태스크 실행 옵션 (기본 인터페이스)
 * 구체적인 태스크 타입별로 확장하여 사용
 */
export interface BaseTaskOptions {
  /** 태스크 고유 식별자 (선택사항, 자동 생성됨) */
  id?: string;
  /** 작업 디렉토리 */
  cwd?: string;
  /** 태스크 메타데이터 */
  metadata?: Record<string, unknown>;
}