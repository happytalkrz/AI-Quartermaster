// @ts-check
'use strict';

/**
 * @fileoverview 프론트엔드 전역 공유 타입 정의 (JSDoc typedef)
 * 이 파일은 타입 정의만 포함하며 런타임에서는 빈 모듈입니다.
 */

/**
 * Job 상태
 * @typedef {'queued'|'running'|'success'|'failure'|'cancelled'|'archived'} JobStatus
 */

/**
 * Job 우선순위
 * @typedef {'high'|'normal'|'low'} JobPriority
 */

/**
 * Claude API 사용량 통계
 * @typedef {Object} UsageStats
 * @property {number} input_tokens
 * @property {number} output_tokens
 * @property {number} [cache_creation_input_tokens]
 * @property {number} [cache_read_input_tokens]
 */

/**
 * 파이프라인 Phase 실행 결과
 * @typedef {Object} PhaseResultInfo
 * @property {string} name
 * @property {boolean} success
 * @property {string} [commit]
 * @property {number} durationMs
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {string} [error]
 * @property {number} [costUsd]
 * @property {UsageStats} [usage]
 */

/**
 * 파이프라인 Job (API 응답 형태)
 * @typedef {Object} Job
 * @property {string} id
 * @property {number} issueNumber
 * @property {string} repo
 * @property {JobStatus} status
 * @property {string} createdAt
 * @property {string} [lastUpdatedAt]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 * @property {string} [prUrl]
 * @property {string} [error]
 * @property {string[]} [logs]
 * @property {string} [currentStep]
 * @property {PhaseResultInfo[]} [phaseResults]
 * @property {number} [progress]
 * @property {JobPriority} [priority]
 * @property {number} [costUsd]
 * @property {number} [totalCostUsd]
 * @property {UsageStats} [totalUsage]
 * @property {boolean} [isRetry]
 * @property {number[]} [dependencies]
 */

/**
 * 잡 큐 상태
 * @typedef {Object} QueueStatus
 * @property {number} running
 * @property {number} queued
 * @property {number} [concurrency]
 * @property {boolean} [paused]
 */

/**
 * 자동화 액션
 * @typedef {Object} AutomationAction
 * @property {string} type
 * @property {string} [label]
 * @property {string} [value]
 */

/**
 * 자동화 규칙
 * @typedef {Object} AutomationRule
 * @property {string} id
 * @property {string} trigger
 * @property {AutomationAction[]} actions
 * @property {boolean} [enabled]
 * @property {string} [description]
 * @property {string} [repoFilter]
 */

/**
 * 프로젝트 설정
 * @typedef {Object} ProjectConfig
 * @property {string} repo
 * @property {string} path
 * @property {string} [label]
 */

/**
 * 전체 AQM 설정
 * @typedef {Object} AqmConfig
 * @property {{instanceLabel?: string, projectName?: string, instanceOwners?: string[]}} [general]
 * @property {ProjectConfig[]} [projects]
 * @property {AutomationRule[]} [automations]
 */

/**
 * /api/jobs SSE 및 REST 응답
 * @typedef {Object} ApiResponse
 * @property {Job[]} [jobs]
 * @property {QueueStatus} [queue]
 * @property {AqmConfig} [config]
 */

