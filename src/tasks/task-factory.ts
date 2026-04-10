import type { AQMTask } from "./aqm-task.js";
import { ClaudeTask, type ClaudeTaskOptions } from "./claude-task.js";
import { ValidationTask, type ValidationTaskOptions } from "./validation-task.js";
import { GitTask, type GitTaskOptions } from "./git-task.js";

/**
 * 태스크 생성 파라미터 (discriminated union)
 * type 필드로 어떤 태스크를 생성할지 결정한다.
 */
export type TaskCreationParams =
  | { type: "claude"; options: ClaudeTaskOptions }
  | { type: "validation"; options: ValidationTaskOptions }
  | { type: "git"; options: GitTaskOptions };

/**
 * JobType에 따라 ClaudeTask / ValidationTask / GitTask 인스턴스를 생성한다.
 *
 * @param params - 태스크 타입과 해당 옵션을 포함하는 discriminated union
 * @returns 생성된 AQMTask 인스턴스
 */
export function createTask(params: TaskCreationParams): AQMTask {
  switch (params.type) {
    case "claude":
      return new ClaudeTask(params.options);
    case "validation":
      return new ValidationTask(params.options);
    case "git":
      return new GitTask(params.options);
  }
}
