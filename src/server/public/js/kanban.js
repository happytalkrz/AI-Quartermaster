/* ══════════════════════════════════════════════════════════════
   Kanban Board Implementation
   ══════════════════════════════════════════════════════════════ */

/**
 * 칸반 보드 상태와 컬럼 매핑
 */
var kanbanColumns = {
  queued: { id: 'queued', title: 'Queued', jobs: [] },
  planning: { id: 'planning', title: 'Planning', jobs: [] },
  implementing: { id: 'implementing', title: 'Implementing', jobs: [] },
  reviewing: { id: 'reviewing', title: 'Reviewing', jobs: [] },
  done: { id: 'done', title: 'Done', jobs: [] }
};

var kanbanContainer = null;
var kanbanEventSource = null;

/**
 * Job 상태를 칸반 컬럼에 매핑
 */
function mapJobToColumn(job) {
  if (job.status === 'queued') {
    return 'queued';
  }

  if (job.status === 'running') {
    // running 상태일 때는 현재 phase나 단계별로 구분
    // 기본적으로 implementing으로 분류하되, 추후 더 세분화 가능
    var currentPhase = job.currentPhase || job.phase || '';

    if (currentPhase.includes('plan') || currentPhase.includes('analyze')) {
      return 'planning';
    } else if (currentPhase.includes('review') || currentPhase.includes('validation')) {
      return 'reviewing';
    } else {
      return 'implementing';
    }
  }

  // 완료된 상태들은 모두 Done 컬럼에
  if (job.status === 'success' || job.status === 'failure' ||
      job.status === 'cancelled' || job.status === 'archived') {
    return 'done';
  }

  return 'queued'; // 기본값
}

/**
 * 칸반 보드 HTML 렌더링
 */
function renderKanbanBoard() {
  if (!kanbanContainer) return;

  var html = '<div class="kanban-board flex gap-6 p-6 overflow-x-auto min-h-screen bg-background">';

  Object.values(kanbanColumns).forEach(function(column) {
    var jobCount = column.jobs.length;
    var columnTitle = column.title + ' (' + jobCount + ')';

    html += '<div class="kanban-column flex-shrink-0 w-80">' +
      '<div class="column-header bg-surface-container p-4 rounded-t-lg border-b border-outline-variant/20">' +
        '<h3 class="text-sm font-semibold text-on-surface">' + esc(columnTitle) + '</h3>' +
      '</div>' +
      '<div class="column-content bg-surface-container-low p-4 rounded-b-lg min-h-96 space-y-3" data-column="' + esc(column.id) + '">';

    // 컬럼 내 Job 카드들 렌더링
    column.jobs.forEach(function(job) {
      html += renderKanbanCard(job);
    });

    // 빈 컬럼일 때 placeholder
    if (column.jobs.length === 0) {
      html += '<div class="text-center text-outline/50 text-sm py-8">No jobs</div>';
    }

    html += '</div></div>';
  });

  html += '</div>';

  kanbanContainer.innerHTML = html;
}

/**
 * Job을 해당 컬럼에 배치
 */
function distributeJobsToColumns(jobs) {
  // 모든 컬럼 초기화
  Object.keys(kanbanColumns).forEach(function(key) {
    kanbanColumns[key].jobs = [];
  });

  // Job을 각 컬럼에 분배
  jobs.forEach(function(job) {
    var columnId = mapJobToColumn(job);
    if (kanbanColumns[columnId]) {
      kanbanColumns[columnId].jobs.push(job);
    }
  });

  // 각 컬럼 내에서 최신순으로 정렬
  Object.values(kanbanColumns).forEach(function(column) {
    column.jobs.sort(function(a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  });
}

/**
 * 칸반 보드용 데이터 핸들링
 */
function handleKanbanData(data) {
  var jobs = data.jobs || [];
  // archived 제외한 활성 Job만 표시
  var activeJobs = jobs.filter(function(job) {
    return job.status !== 'archived';
  });

  distributeJobsToColumns(activeJobs);
  renderKanbanBoard();
}

/**
 * SSE 이벤트 핸들러 - 기존 패턴 확장
 */
function handleKanbanSSEEvent(event) {
  try {
    var data = JSON.parse(event.data);

    // 기존 handleData와 동일한 데이터 구조 처리
    handleKanbanData(data);

  } catch (error) {
    console.error('Kanban SSE event parse error:', error);
  }
}

/**
 * 칸반 보드 SSE 연결
 */
function connectKanbanSSE() {
  if (kanbanEventSource) {
    try {
      kanbanEventSource.close();
    } catch(e) {}
  }

  var key = getApiKey ? getApiKey() : '';
  var params = [];

  if (key) {
    params.push('key=' + encodeURIComponent(key));
  }

  if (typeof currentProject !== 'undefined' && currentProject && currentProject !== 'all') {
    params.push('project=' + encodeURIComponent(currentProject));
  }

  var sseUrl = '/api/events' + (params.length > 0 ? '?' + params.join('&') : '');
  kanbanEventSource = new EventSource(sseUrl);

  kanbanEventSource.onopen = function() {
    console.log('Kanban SSE connected');
  };

  kanbanEventSource.onmessage = handleKanbanSSEEvent;

  kanbanEventSource.onerror = function() {
    console.log('Kanban SSE connection error');
    kanbanEventSource.close();
    // 4초 후 재연결
    setTimeout(connectKanbanSSE, 4000);
  };
}

/**
 * 칸반 보드 초기화
 */
function initKanban() {
  kanbanContainer = document.getElementById('kanban-container');

  if (!kanbanContainer) {
    console.error('Kanban container not found');
    return;
  }

  // 초기 데이터 로드
  if (typeof currentJobs !== 'undefined' && currentJobs) {
    handleKanbanData({ jobs: currentJobs });
  }

  // SSE 연결
  connectKanbanSSE();

  console.log('Kanban board initialized');
}

/**
 * 칸반 보드 정리
 */
function destroyKanban() {
  if (kanbanEventSource) {
    kanbanEventSource.close();
    kanbanEventSource = null;
  }

  if (kanbanContainer) {
    kanbanContainer.innerHTML = '';
  }

  // 컬럼 초기화
  Object.keys(kanbanColumns).forEach(function(key) {
    kanbanColumns[key].jobs = [];
  });
}

/**
 * esc 함수가 정의되지 않은 경우 fallback
 */
if (typeof esc === 'undefined') {
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// 전역 함수로 노출
window.initKanban = initKanban;
window.destroyKanban = destroyKanban;
window.handleKanbanData = handleKanbanData;