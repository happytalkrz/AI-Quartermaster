# Orchestrator.ts 분석 및 Thin Orchestrator 패턴 회귀 방지

## 개요

`src/pipeline/orchestrator.ts`가 139줄에서 195줄(56줄 증가)로 커져서 God Function 패턴으로 회귀하고 있습니다. Thin Orchestrator 패턴(상태 전환과 모듈 호출만 담당)에 맞지 않는 비즈니스 로직들이 포함되어 있어 이를 적절한 모듈로 분리해야 합니다.

## 현재 상태 분석

### 파일 정보
- **현재 줄 수**: 195줄 
- **목표 줄 수**: 140줄 이하
- **축소 필요**: 55+ 줄

### Git Blame 분석을 통한 추가된 로직 식별

#### 1. Feasibility Check 처리 로직 (22줄) - **분리 필요**
**위치**: 122-148줄  
**커밋**: `8a858c3f`, `ab9fc788` (2026-04-04)
```typescript
// FEASIBILITY_SKIP 에러 체크
const isFeasibilitySkip = errorMessage.startsWith("FEASIBILITY_SKIP:");
if (isFeasibilitySkip) {
  // basicPlan 생성 로직
  // formatResult 호출
  // skipReason 파싱
}
```
**문제**: orchestrator가 특정 에러 타입의 비즈니스 로직을 직접 처리

#### 2. Core Loop Failure 처리 (7줄) - **분리 필요**
**위치**: 150-156줄  
**커밋**: `9fc8510a`, `e7607598` (2026-04-03/04)
```typescript
const errorWithReport = error as Error & { failureResult?: OrchestratorResult };
if (errorWithReport.failureResult) {
  // 특수한 에러 타입 처리
}
```
**문제**: 타입 캐스팅과 특수 에러 처리 로직

#### 3. General Pipeline Failure 처리 (33줄) - **분리 필요**
**위치**: 158-190줄  
**커밋**: `9fc8510a`, `59cfa57e`, `9bdfdea6` (2026-04-03)
```typescript
const failureContext = {
  // 복잡한 컨텍스트 생성 (12개 필드)
};
const finalErrorMessage = await handlePipelineFailure(failureContext);
// basicPlan 생성 (중복 코드)
// formatResult 호출 (중복 코드)
```
**문제**: 복잡한 실패 컨텍스트 생성 + 중복된 보고서 생성 로직

#### 4. prUrl 검증 로직 (12줄) - **단순화 필요**
**위치**: 100-111줄  
**커밋**: `9ce6968a`, `9c98bfa8` (2026-04-04)
```typescript
if (!finalResult.prUrl) {
  transitionState(runtime, "FAILED");
  const errorMessage = "Pipeline completed but failed to create PR URL";
  return {
    // 복잡한 반환 객체 생성
  };
}
```
**문제**: 비즈니스 로직 검증이 orchestrator에 포함

#### 5. Validation 로직 (10줄) - **단순화 가능**
**위치**: 36-45줄  
**커밋**: `4440366f`, `732bb8d3` (2026-04-04)
```typescript
if (!issue) {
  throw new Error("Issue not fetched during setup");
}
if (!mode) {
  throw new Error("Pipeline mode not determined during setup");
}
const checkpointFn = checkpoint || (() => {});
```
**문제**: null 체크와 기본값 설정이 orchestrator에 직접 포함

#### 6. Finally 블록 (4줄) - **유지 필요**
**위치**: 191-194줄  
**커밋**: `96964e8b` (2026-04-04)
```typescript
} finally {
  clearCache();
}
```
**정당성**: 리소스 정리는 orchestrator의 적절한 책임

## Thin Orchestrator 패턴 위배 사항

### 현재 orchestrator의 책임 (문제점)
1. ✗ 특정 에러 타입별 처리 로직 (FEASIBILITY_SKIP)
2. ✗ 복잡한 실패 컨텍스트 생성 
3. ✗ 중복된 basicPlan 생성 로직 (2군데)
4. ✗ 중복된 formatResult 호출 (2군데)
5. ✗ prUrl 비즈니스 검증 로직
6. ✗ null 체크 및 기본값 설정

### 올바른 Thin Orchestrator 패턴
- ✓ 상태 전환 (transitionState 호출)
- ✓ 모듈 간 호출 조율
- ✓ 기본적인 try-catch 구조
- ✓ 리소스 정리 (finally)

## 분리 대상 로직 식별

### 1. Pipeline Error Handler 모듈 확장
**대상**: 122-148줄 (Feasibility Check), 158-190줄 (General Failure)
**새 파일**: `src/pipeline/pipeline-error-handler.ts` (이미 존재, 확장 필요)
**분리할 함수**:
- `handleFeasibilitySkipError()`
- `handleGeneralPipelineFailure()`

### 2. Pipeline Result Validator 모듈 생성  
**대상**: 100-111줄 (prUrl 검증)
**새 파일**: `src/pipeline/pipeline-result-validator.ts`
**분리할 함수**:
- `validatePipelineResult()`

### 3. Pipeline Setup Validator 확장
**대상**: 36-45줄 (Setup 검증)
**기존 파일**: `src/pipeline/pipeline-setup.ts` 확장
**분리할 함수**:
- `validateSetupResult()`

## 중복 코드 제거

### basicPlan 생성 로직 (2회 중복)
**위치**: 129-139줄, 177-187줄
**해결**: 공통 유틸리티 함수로 추출

### formatResult 호출 (2회 중복)  
**위치**: 140줄, 188줄
**해결**: error handler에서 통합 처리

## 목표 아키텍처

```
runPipeline() {
  try {
    // Phase 1-4: 모듈 호출만
    // 단순한 결과 반환
  } catch (error) {
    // 간단한 에러 라우팅만
    return await routeError(error, context);
  } finally {
    clearCache();
  }
}
```

## 예상 효과

- **줄 수**: 195줄 → 135줄 (60줄 감소, 목표 달성)
- **책임**: 순수한 상태 전환 + 모듈 호출 조율로 회귀
- **가독성**: 복잡한 에러 처리 로직 분리로 향상
- **테스트**: 각 에러 처리 로직을 독립적으로 테스트 가능
- **유지보수**: 에러 처리 변경 시 orchestrator 수정 불필요