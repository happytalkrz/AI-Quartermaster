// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   i18n
   ══════════════════════════════════════════════════════════════ */
/** @type {Record<string, Record<string, unknown>>} */
var i18n = {
  ko: {
    dashboard: "대시보드",
    logs: "로그",
    repositories: {
      _: "저장소",
      subtitle: "등록된 레포지토리와 스토리지 사용량을 관리합니다.",
      totalDbSize: "전체 DB 크기",
      logVolume: "로그 볼륨",
      addRepo: "저장소 추가",
      addRepoDesc: "새 Git 레포지토리를 연결합니다",
      loading: "로딩 중...",
      storageMgmt: "스토리지 관리",
      storageDesc: "AQM은 기본적으로 텔레메트리 데이터를 30일간 보관합니다. 오래된 데이터를 정리하여 디스크 공간을 확보할 수 있습니다.",
      retention: "데이터 보관율",
      cleanData: "오래된 데이터 정리"
    },
    automations: "자동화",
    settings: { _: "설정", general: "일반", safety: "안전", review: "리뷰" },
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
    deleteProjectConfirm: "프로젝트 삭제",
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
    projects: "프로젝트",
    addProject: "프로젝트 추가",
    repository: "저장소",
    repositoryPath: "저장소 경로",
    repositoryPlaceholder: "예: /home/user/my-project",
    label: "라벨",
    triggerLabel: "트리거 라벨",
    labelPlaceholder: "예: implement",
    add: "추가",
    activeOrchestration: "활성 오케스트레이션",
    globalConfig: "글로벌 설정",
    localPath: "로컬 경로",
    branch: "브랜치",
    enabled: "활성",
    disabled: "비활성",
    config: {
      tabs: { general: "일반", safety: "안전", review: "리뷰" },
      saveState: { saving: "저장 중...", saved: "저장됨", saveFailed: "저장 실패" },
      form: { edit: "편집", reset: "초기화", resetConfirm: "설정을 초기화하시겠습니까?", saveChanges: "변경사항 저장", discardChanges: "변경사항 취소" }
    }
  },
  en: {
    dashboard: "Dashboard",
    logs: "Logs",
    repositories: {
      _: "Repositories",
      subtitle: "Manage registered repositories and storage usage.",
      totalDbSize: "Total DB Size",
      logVolume: "Log Volume",
      addRepo: "Add Repository",
      addRepoDesc: "Connect a new Git repository",
      loading: "Loading...",
      storageMgmt: "Storage Management",
      storageDesc: "AQM retains telemetry data for 30 days by default. Clean up old data to free disk space.",
      retention: "Data Retention",
      cleanData: "Clean Old Data"
    },
    automations: "Automations",
    settings: { _: "Settings", general: "General", safety: "Safety", review: "Review" },
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
    deleteProjectConfirm: "Delete Project",
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
    projects: "Projects",
    addProject: "Add Project",
    repository: "Repository",
    repositoryPath: "Repository Path",
    repositoryPlaceholder: "e.g. /home/user/my-project",
    label: "Label",
    triggerLabel: "Trigger Label",
    labelPlaceholder: "e.g. implement",
    add: "Add",
    activeOrchestration: "Active Orchestration",
    globalConfig: "Global Configuration",
    localPath: "Local Path",
    branch: "Branch",
    enabled: "Enabled",
    disabled: "Disabled",
    config: {
      tabs: { general: "General", safety: "Safety", review: "Review" },
      saveState: { saving: "Saving...", saved: "Saved", saveFailed: "Save Failed" },
      form: { edit: "Edit", reset: "Reset", resetConfirm: "Reset all settings to default?", saveChanges: "Save Changes", discardChanges: "Discard Changes" }
    }
  }
};

/** @type {string} */
var currentLang = localStorage.getItem('aqm-lang') || 'ko';

/**
 * @param {string} key
 * @returns {string}
 */
function t(key) {
  var keys = key.split('.');
  /** @type {any} */
  var val = i18n[currentLang];
  for (var i = 0; i < keys.length; i++) val = val ? val[keys[i]] : undefined;
  if (val !== undefined && val !== null && typeof val === 'object' && val._) return String(val._);
  return val !== undefined && val !== null ? String(val) : key;
}

/** @returns {void} */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var htmlEl = /** @type {HTMLElement} */ (el);
    htmlEl.textContent = t(htmlEl.dataset.i18n || '');
  });
  var langLabel = document.getElementById('lang-label');
  if (langLabel) langLabel.textContent = currentLang.toUpperCase();
  var htmlRoot = document.getElementById('html-root');
  if (htmlRoot) htmlRoot.lang = currentLang;
}

/** @returns {void} */
function toggleLang() {
  currentLang = currentLang === 'ko' ? 'en' : 'ko';
  localStorage.setItem('aqm-lang', currentLang);
  applyTranslations();
  renderFromState();
}
