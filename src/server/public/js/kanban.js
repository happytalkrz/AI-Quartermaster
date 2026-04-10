'use strict';

/* ══════════════════════════════════════════════════════════════
   Kanban Board — Pipeline Stage Visualization
   ══════════════════════════════════════════════════════════════ */

var KANBAN_COLUMNS = [
  { id: 'queued',       label: 'Queued',       letter: 'Q', letterColor: 'text-outline',   letterBg: 'bg-surface-container-highest' },
  { id: 'planning',     label: 'Planning',     letter: 'P', letterColor: 'text-primary',   letterBg: 'bg-surface-container-highest' },
  { id: 'implementing', label: 'Implementing', letter: 'I', letterColor: 'text-primary',   letterBg: 'bg-primary-container/20'      },
  { id: 'reviewing',    label: 'Reviewing',    letter: 'R', letterColor: 'text-tertiary',  letterBg: 'bg-surface-container-highest' },
  { id: 'done',         label: 'Done',         letter: 'D', letterColor: 'text-[#3fb950]', letterBg: 'bg-surface-container-highest' },
];

/* ══════════════════════════════════════════════════════════════
   Column Mapping
   ══════════════════════════════════════════════════════════════ */
function getJobKanbanColumn(job) {
  if (job.status === 'queued') return 'queued';

  if (job.status === 'running') {
    var step = (job.currentStep || '').toLowerCase();
    if (step.includes('plan')) return 'planning';
    if (step.includes('review')) return 'reviewing';
    return 'implementing';
  }

  // success, failure, cancelled, archived
  return 'done';
}

/* ══════════════════════════════════════════════════════════════
   Priority Visual Helpers
   ══════════════════════════════════════════════════════════════ */
/**
 * 숫자 priority → 'high' | 'normal' | 'low'
 * 낮을수록 먼저 처리: 0=high, 1=normal, ≥2=low, undefined=normal
 */
function getPriorityLevel(priority) {
  if (typeof priority !== 'number') return 'normal';
  if (priority === 0) return 'high';
  if (priority === 1) return 'normal';
  return 'low';
}

/* ══════════════════════════════════════════════════════════════
   Card Rendering
   ══════════════════════════════════════════════════════════════ */
function renderKanbanCard(job) {
  var isRunning  = job.status === 'running';
  var isFailed   = job.status === 'failure';
  var isDone     = job.status === 'success' || job.status === 'cancelled' || job.status === 'archived';
  var pct        = typeof job.progress === 'number' ? job.progress : 0;
  var title      = job.issueTitle || (job.repo + ' #' + job.issueNumber);
  var issueRef   = '#' + job.issueNumber;

  var cardClass, headerHtml, bodyHtml;
  var priorityBarHtml = '';

  if (isRunning) {
    cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/30 bg-gradient-to-br from-[#262a31] to-[#1c2026] relative overflow-hidden group cursor-pointer';
    headerHtml =
      '<div class="absolute top-0 right-0 p-2"><div class="pulse-dot"></div></div>' +
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-primary font-bold tracking-wider">' + esc(issueRef) + '</span>' +
      '</div>';
    bodyHtml =
      '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + esc(title) + '</h4>' +
      '<div class="space-y-3">' +
        '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
          '<span class="flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[12px] animate-spin">refresh</span>' +
            ' SYNCING' +
          '</span>' +
          '<span class="text-primary">' + pct + '%</span>' +
        '</div>' +
        '<div class="w-full h-1.5 bg-surface-container-low rounded-full overflow-hidden">' +
          '<div class="h-full bg-gradient-to-r from-primary to-primary-container rounded-full" style="width:' + pct + '%"></div>' +
        '</div>' +
      '</div>';

  } else if (isFailed) {
    cardClass = 'bg-[#262a31] p-4 rounded-md border border-error/20 hover:border-error/40 transition-all cursor-pointer group';
    headerHtml =
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-error/60 font-bold tracking-wider">' + esc(issueRef) + '</span>' +
        '<span class="material-symbols-outlined text-[18px] text-error">report</span>' +
      '</div>';
    var errMsg = job.error ? esc(job.error).substring(0, 48) : 'ERR: PIPELINE_FAILED';
    bodyHtml =
      '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + esc(title) + '</h4>' +
      '<div class="p-2 bg-error-container/20 rounded text-[10px] font-mono text-error mb-4">' + errMsg + '</div>' +
      '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
        '<div class="h-full bg-error rounded-full" style="width:' + pct + '%"></div>' +
      '</div>';

  } else if (isDone) {
    cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/15 group cursor-pointer';
    headerHtml =
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-outline-variant font-bold tracking-wider">' + esc(issueRef) + '</span>' +
        '<span class="material-symbols-outlined text-[18px] text-[#3fb950]">check_circle</span>' +
      '</div>';
    var completedAgo = relativeTime(job.completedAt || job.lastUpdatedAt || job.createdAt);
    bodyHtml =
      '<h4 class="text-sm font-medium text-on-surface/50 mb-4 leading-snug line-through">' + esc(title) + '</h4>' +
      '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
        '<span>COMPLETED</span>' +
        '<span class="text-[#3fb950]">' + completedAgo + '</span>' +
      '</div>';

  } else {
    // queued — priority에 따라 시각적 처리 분기
    var pLevel = getPriorityLevel(job.priority);
    var elapsed = fmtDuration(job) || relativeTime(job.createdAt);

    if (pLevel === 'high') {
      // high: 빨강 좌측 바 + 빨강 우선순위 아이콘
      cardClass = 'bg-[#262a31] p-4 pl-5 rounded-md border border-error/25 hover:border-error/50 transition-all cursor-grab group relative overflow-hidden';
      priorityBarHtml = '<div class="absolute left-0 top-0 bottom-0 w-1 rounded-l-md" style="background:rgba(255,180,171,0.7)"></div>';
      headerHtml =
        '<div class="flex justify-between items-start mb-3">' +
          '<span class="text-[10px] font-mono text-error/80 font-bold tracking-wider">' + esc(issueRef) + '</span>' +
          '<div class="flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-error/80" style="font-variation-settings:\'FILL\' 1,\'wght\' 600">keyboard_double_arrow_up</span>' +
            '<span class="material-symbols-outlined text-[16px] text-outline-variant/60 group-hover:text-primary transition-colors select-none">drag_indicator</span>' +
          '</div>' +
        '</div>';
      bodyHtml =
        '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + esc(title) + '</h4>' +
        '<div class="space-y-3">' +
          '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
            '<span>ELAPSED</span>' +
            '<span class="text-on-surface-variant">' + elapsed + '</span>' +
          '</div>' +
          '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
            '<div class="h-full bg-error/40 rounded-full" style="width:0%"></div>' +
          '</div>' +
        '</div>';

    } else if (pLevel === 'low') {
      // low: 회색 처리 (opacity 낮춤) + 하향 아이콘
      cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/10 hover:border-primary/30 transition-all cursor-grab group opacity-55 hover:opacity-90';
      headerHtml =
        '<div class="flex justify-between items-start mb-3">' +
          '<span class="text-[10px] font-mono text-outline-variant/60 font-bold tracking-wider">' + esc(issueRef) + '</span>' +
          '<div class="flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-outline-variant/50">keyboard_double_arrow_down</span>' +
            '<span class="material-symbols-outlined text-[16px] text-outline-variant/50 group-hover:text-primary transition-colors select-none">drag_indicator</span>' +
          '</div>' +
        '</div>';
      bodyHtml =
        '<h4 class="text-sm font-medium text-on-surface/60 mb-4 leading-snug">' + esc(title) + '</h4>' +
        '<div class="space-y-3">' +
          '<div class="flex items-center justify-between text-[10px] font-mono text-outline/60">' +
            '<span>ELAPSED</span>' +
            '<span class="text-on-surface-variant/60">' + elapsed + '</span>' +
          '</div>' +
          '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
            '<div class="h-full bg-outline-variant/40 rounded-full" style="width:0%"></div>' +
          '</div>' +
        '</div>';

    } else {
      // normal: 기본 스타일
      cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/15 hover:border-primary/40 transition-all cursor-grab group';
      headerHtml =
        '<div class="flex justify-between items-start mb-3">' +
          '<span class="text-[10px] font-mono text-outline-variant font-bold tracking-wider">' + esc(issueRef) + '</span>' +
          '<span class="material-symbols-outlined text-[16px] text-outline-variant group-hover:text-primary transition-colors select-none">drag_indicator</span>' +
        '</div>';
      bodyHtml =
        '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + esc(title) + '</h4>' +
        '<div class="space-y-3">' +
          '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
            '<span>ELAPSED</span>' +
            '<span class="text-on-surface-variant">' + elapsed + '</span>' +
          '</div>' +
          '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
            '<div class="h-full bg-outline-variant rounded-full" style="width:0%"></div>' +
          '</div>' +
        '</div>';
    }

    return '<div class="' + cardClass + '" data-job-id="' + esc(job.id) + '"' +
      ' draggable="true"' +
      ' ondragstart="kanbanDragStart(event)"' +
      ' ondragend="kanbanDragEnd(event)"' +
      ' onclick="selectJob(\'' + esc(job.id) + '\')">' +
      priorityBarHtml + headerHtml + bodyHtml +
    '</div>';
  }

  return '<div class="' + cardClass + '" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
    headerHtml + bodyHtml +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Column Rendering
   ══════════════════════════════════════════════════════════════ */
function renderKanbanColumn(col, jobs) {
  var cardsHtml = jobs.length > 0
    ? jobs.map(renderKanbanCard).join('')
    : '<div class="text-center text-outline text-xs font-mono py-8">EMPTY</div>';

  var listClass = 'flex-1 p-3 space-y-3 overflow-y-auto custom-scrollbar' +
    (col.id === 'done' ? ' opacity-70 hover:opacity-100 transition-opacity' : '');

  var listAttrs = col.id === 'queued'
    ? ' ondragover="kanbanDragOver(event)" ondrop="kanbanDrop(event)"'
    : '';

  return '<div class="w-[280px] flex-shrink-0 flex flex-col h-full bg-[#181c22] rounded-lg">' +
    '<div class="p-4 flex items-center justify-between border-b border-outline-variant/10">' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-[11px] font-mono ' + col.letterBg + ' px-1.5 py-0.5 rounded ' + col.letterColor + '">' + col.letter + '</span>' +
        '<h3 class="font-headline font-bold text-sm tracking-wide uppercase text-on-surface">' + col.label + '</h3>' +
      '</div>' +
      '<span class="text-xs font-mono text-outline-variant">' + jobs.length + '</span>' +
    '</div>' +
    '<div class="' + listClass + '"' + listAttrs + '>' + cardsHtml + '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Board Rendering
   ══════════════════════════════════════════════════════════════ */
function renderKanban(jobs) {
  var columnJobs = {};
  KANBAN_COLUMNS.forEach(function(col) { columnJobs[col.id] = []; });

  jobs.forEach(function(job) {
    var colId = getJobKanbanColumn(job);
    if (columnJobs[colId]) columnJobs[colId].push(job);
  });

  return KANBAN_COLUMNS.map(function(col) {
    return renderKanbanColumn(col, columnJobs[col.id]);
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   Drag & Drop — Queued Column Only
   ══════════════════════════════════════════════════════════════ */
var _dnd = { draggingId: null };

function kanbanDragStart(e) {
  var card = e.currentTarget;
  _dnd.draggingId = card.dataset.jobId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dnd.draggingId);
  setTimeout(function() { card.style.opacity = '0.4'; }, 0);
}

function kanbanDragEnd(e) {
  e.currentTarget.style.opacity = '';
  _dnd.draggingId = null;
  _kanbanRemoveIndicator();
}

function kanbanDragOver(e) {
  if (!_dnd.draggingId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  var target = _kanbanFindCardTarget(e);
  _kanbanRemoveIndicator();

  var list = e.currentTarget;
  var indicator = document.createElement('div');
  indicator.id = 'dnd-indicator';
  indicator.style.cssText = 'height:2px;background:#6750a4;border-radius:1px;margin:2px 0;pointer-events:none;';

  if (target) {
    var before = (e.clientY - target.getBoundingClientRect().top) < target.offsetHeight / 2;
    if (before) {
      list.insertBefore(indicator, target);
    } else {
      list.insertBefore(indicator, target.nextSibling);
    }
  } else {
    list.appendChild(indicator);
  }
}

function kanbanDrop(e) {
  e.preventDefault();
  _kanbanRemoveIndicator();

  var dragId = _dnd.draggingId;
  if (!dragId) return;

  var target = _kanbanFindCardTarget(e);
  var list = e.currentTarget;
  var cards = Array.from(list.querySelectorAll('[data-job-id]'));
  var ids = cards.map(function(c) { return c.dataset.jobId; });

  var fromIdx = ids.indexOf(dragId);
  if (fromIdx === -1) return;

  // 롤백용 원본 순서 스냅샷
  var originalNodes = cards.slice();

  ids.splice(fromIdx, 1);

  var insertIdx = ids.length; // default: end
  if (target) {
    var targetId = target.dataset.jobId;
    var targetIdx = ids.indexOf(targetId);
    var dropBefore = (e.clientY - target.getBoundingClientRect().top) < target.offsetHeight / 2;
    insertIdx = dropBefore ? targetIdx : targetIdx + 1;
  }
  ids.splice(insertIdx, 0, dragId);

  // 낙관적 UI: DOM 즉시 재정렬
  ids.forEach(function(id) {
    var card = list.querySelector('[data-job-id="' + id + '"]');
    if (card) list.appendChild(card);
  });

  // API 호출 — 실패 시 원본 순서로 롤백
  var promises = ids.map(function(id, idx) {
    return apiFetch('/api/jobs/' + encodeURIComponent(id) + '/priority', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: idx })
    }).then(function(r) {
      if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status));
    });
  });

  Promise.all(promises).catch(function() {
    originalNodes.forEach(function(card) { list.appendChild(card); });
  });
}

function _kanbanFindCardTarget(e) {
  var list = e.currentTarget;
  var cards = Array.from(list.querySelectorAll('[data-job-id]'));
  if (cards.length === 0) return null;
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var rect = card.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var dist = Math.abs(e.clientY - midY);
    if (dist < bestDist) { bestDist = dist; best = card; }
  }
  return best;
}

function _kanbanRemoveIndicator() {
  var el = document.getElementById('dnd-indicator');
  if (el) el.parentNode.removeChild(el);
}
