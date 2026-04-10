/**
 * AQM Tasks 모듈 - 태스크 인터페이스 및 구현체 export
 */

// 기본 인터페이스 및 타입 정의
export {
  AQMTask,
  TaskStatus,
  AQMTaskType,
  AQMTaskSummary,
  BaseTaskOptions,
  SerializedTask,
  TaskLifecycleEvent,
  TaskEventListener,
  TaskEventEmitter
} from "./aqm-task.js";

// Claude 태스크 구현체
export {
  ClaudeTask,
  ClaudeTaskOptions
} from "./claude-task.js";

// Validation 태스크 구현체 (typecheck/lint/test)
export {
  ValidationTask,
  ValidationTaskOptions,
  ValidationTaskType,
  ValidationResult,
} from "./validation-task.js";

// Git 태스크 구현체 (branch/commit/push/pr)
export {
  GitTask,
  GitTaskOptions,
  GitOperationType,
  GitOperationResult,
  GitOperationOptions,
  BranchOperationOptions,
  CommitOperationOptions,
  PushOperationOptions,
  PrOperationOptions,
} from "./git-task.js";

// TaskFactory — JobHandler 위에 얹히는 선택적 통합 레이어
export {
  TaskFactory,
  DefaultTaskFactory,
} from "./task-factory.js";