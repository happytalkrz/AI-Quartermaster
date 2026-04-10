import type { AQMTask } from "./aqm-task.js";
import type { Job } from "../types/pipeline.js";
import type { TaskFactory } from "./task-factory.js";

/**
 * 잡 타입별 TaskFactory를 관리하는 레지스트리
 * 태스크 타입 문자열을 키로 사용하여 팩토리를 등록/조회한다
 */
export class TaskRegistry {
  private readonly factories = new Map<string, TaskFactory>();

  /**
   * 태스크 타입에 팩토리를 등록
   * @param type 태스크 타입 식별자 (예: "claude", "validation", "git")
   * @param factory 해당 타입의 태스크를 생성하는 팩토리
   */
  register(type: string, factory: TaskFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * 등록된 팩토리를 태스크 타입으로 조회
   * @param type 태스크 타입 식별자
   * @returns 등록된 팩토리 또는 undefined
   */
  get(type: string): TaskFactory | undefined {
    return this.factories.get(type);
  }

  /**
   * 태스크 타입이 등록되어 있는지 확인
   * @param type 태스크 타입 식별자
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * 등록된 팩토리를 사용해 태스크를 생성
   * @param type 태스크 타입 식별자
   * @param job 실행할 잡 정보
   * @throws 해당 타입의 팩토리가 등록되어 있지 않으면 에러
   */
  create(type: string, job: Job): AQMTask {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`No factory registered for task type: ${type}`);
    }
    return factory.create(job);
  }

  /**
   * 등록된 모든 태스크 타입 목록 반환
   */
  getRegisteredTypes(): string[] {
    return [...this.factories.keys()];
  }
}
