import type { Job } from "../types/pipeline.js";
import type { AQMTask } from "./aqm-task.js";

/**
 * 잡 타입별 AQMTask 인스턴스를 생성하는 팩토리 인터페이스
 */
export interface TaskFactory {
  /**
   * 주어진 Job으로부터 AQMTask 인스턴스를 생성
   * @param job 실행할 잡 정보
   * @returns 생성된 AQMTask 인스턴스
   */
  create(job: Job): AQMTask;
}
