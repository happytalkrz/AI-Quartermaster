'use strict';

/* ══════════════════════════════════════════════════════════════
   i18n
   ══════════════════════════════════════════════════════════════ */
var i18n = {
  ko: {
    dashboard: "대시보드",
    logs: "로그",
    repositories: "저장소",
    automations: "자동화",
    settings: "설정",
    totalJobs: "전체 작업",
    successRate: "성공률",
    active: "실행 중",
    failed: "실패",
    recentOps: "최근 작업",
    comingSoon: "준비 중",
    noJobSelected: "작업을 선택하세요",
    noJobs: "등록된 작업이 없습니다",
    cancel: "취소",
    retry: "재시도",
    delete: "삭제",
    clearAll: "전체 삭제",
    clearAllConfirm: "완료/실패된 모든 작업을 삭제하시겠습니까?",
    cancelConfirm: "이 작업을 취소하시겠습니까?",
    confirm: "확인",
    hideArchived: "아카이브 숨기기",
    filter: { all: "전체", running: "실행 중", success: "성공", failure: "실패", queued: "대기" },
    phase: "단계",
    duration: "소요시간",
    telemetry: "텔레메트리 스트림",
    expandLogs: "전체 로그 보기",
    pipeline: "파이프라인 진행률",
    complete: "완료",
    prLink: "PR 링크",
    error: "에러",
    apiKeyPrompt: "API 키를 입력하세요",
    save: "저장",
    newAutomation: "새 자동화",
    commandHQ: "커맨드 HQ",
    jobDetail: "작업 상세",
    phaseProgress: "단계 진행률",
    // 설정 편집 UI 메시지
    config: {
      tabs: {
        general: "일반",
        safety: "안전",
        review: "리뷰"
      },
      saveState: {
        saving: "저장 중...",
        saved: "저장됨",
        saveFailed: "저장 실패"
      },
      form: {
        edit: "편집",
        reset: "초기화",
        resetConfirm: "설정을 초기화하시겠습니까?",
        saveChanges: "변경사항 저장",
        discardChanges: "변경사항 취소"
      }
    },
  },
  en: {
    dashboard: "Dashboard",
    logs: "Logs",
    repositories: "Repositories",
    automations: "Automations",
    settings: "Settings",
    totalJobs: "Total Jobs",
    successRate: "Success Rate",
    active: "Active",
    failed: "Failed",
    recentOps: "Recent Operations",
    comingSoon: "Coming Soon",
    noJobSelected: "Select a job to view details",
    noJobs: "No jobs found",
    cancel: "Cancel",
    retry: "Retry",
    delete: "Delete",
    clearAll: "Clear All",
    clearAllConfirm: "Delete all completed/failed jobs?",
    cancelConfirm: "Cancel this job?",
    confirm: "Confirm",
    hideArchived: "Hide Archived",
    filter: { all: "All", running: "Running", success: "Success", failure: "Failed", queued: "Queued" },
    phase: "Phase",
    duration: "Duration",
    telemetry: "Telemetry Stream",
    expandLogs: "Expand Full Logs",
    pipeline: "Pipeline Progress",
    complete: "Complete",
    prLink: "PR Link",
    error: "Error",
    apiKeyPrompt: "Enter API Key",
    save: "Save",
    newAutomation: "New Automation",
    commandHQ: "Command HQ",
    jobDetail: "Job Detail",
    phaseProgress: "Phase Progress",
    // Settings edit UI messages
    config: {
      tabs: {
        general: "General",
        safety: "Safety",
        review: "Review"
      },
      saveState: {
        saving: "Saving...",
        saved: "Saved",
        saveFailed: "Save Failed"
      },
      form: {
        edit: "Edit",
        reset: "Reset",
        resetConfirm: "Reset all settings to default?",
        saveChanges: "Save Changes",
        discardChanges: "Discard Changes"
      }
    },
  }
};

var currentLang = localStorage.getItem('aqm-lang') || 'ko';

function t(key) {
  var keys = key.split('.');
  var val = i18n[currentLang];
  for (var i = 0; i < keys.length; i++) val = val ? val[keys[i]] : undefined;
  return val !== undefined && val !== null ? val : key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('lang-label').textContent = currentLang.toUpperCase();
  document.getElementById('html-root').lang = currentLang;
}

function toggleLang() {
  currentLang = currentLang === 'ko' ? 'en' : 'ko';
  localStorage.setItem('aqm-lang', currentLang);
  applyTranslations();
  renderFromState();
}
