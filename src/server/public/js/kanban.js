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
   Priority Colors
   ══════════════════════════════════════════════════════════════ */
function getPriorityColorClass(priority) {
  switch (priority) {
    case 'high': return 'text-red-500';
    case 'normal': return 'text-yellow-400';
    case 'low': return 'text-gray-400';
    default: return 'text-gray-400';
  }
}

/* ══════════════════════════════════════════════════════════════
   Card Rendering
   ══════════════════════════════════════════════════════════════ */
function renderKanbanCard(job) {
  var isRunning  = job.status === 'running';
  var isFailed   = job.status === 'failure';
  var isDone     = job.status === 'success' || job.status === 'cancelled' || job.status === 'archived';
  var isQueued   = job.status === 'queued';
  var pct        = typeof job.progress === 'number' ? job.progress : 0;
  var title      = job.issueTitle || (job.repo + ' #' + job.issueNumber);
  var issueRef   = '#' + job.issueNumber;
  var priorityClass = getPriorityColorClass(job.priority);

  var cardClass, headerHtml, bodyHtml;
  var draggableAttr = isQueued ? ' draggable="true"' : '';

  if (isRunning) {
    cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/30 bg-gradient-to-br from-[#262a31] to-[#1c2026] relative overflow-hidden group cursor-pointer';
    headerHtml =
      '<div class="absolute top-0 right-0 p-2"><div class="pulse-dot"></div></div>' +
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-primary font-bold tracking-wider">' + esc(issueRef) + '</span>' +
        (job.priority ? '<span class="text-[8px] font-mono ' + priorityClass + ' font-bold">' + job.priority.toUpperCase() + '</span>' : '') +
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
        '<div class="flex items-center gap-2">' +
          (job.priority ? '<span class="text-[8px] font-mono ' + priorityClass + ' font-bold">' + job.priority.toUpperCase() + '</span>' : '') +
          '<span class="material-symbols-outlined text-[18px] text-error">report</span>' +
        '</div>' +
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
        '<div class="flex items-center gap-2">' +
          (job.priority ? '<span class="text-[8px] font-mono ' + priorityClass + ' font-bold">' + job.priority.toUpperCase() + '</span>' : '') +
          '<span class="material-symbols-outlined text-[18px] text-[#3fb950]">check_circle</span>' +
        '</div>' +
      '</div>';
    var completedAgo = relativeTime(job.completedAt || job.lastUpdatedAt || job.createdAt);
    bodyHtml =
      '<h4 class="text-sm font-medium text-on-surface/50 mb-4 leading-snug line-through">' + esc(title) + '</h4>' +
      '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
        '<span>COMPLETED</span>' +
        '<span class="text-[#3fb950]">' + completedAgo + '</span>' +
      '</div>';

  } else {
    // queued
    cardClass = 'bg-[#262a31] p-4 rounded-md border border-[#414752]/15 hover:border-primary/40 transition-all cursor-pointer group';
    headerHtml =
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-outline-variant font-bold tracking-wider">' + esc(issueRef) + '</span>' +
        '<div class="flex items-center gap-2">' +
          (job.priority ? '<span class="text-[8px] font-mono ' + priorityClass + ' font-bold">' + job.priority.toUpperCase() + '</span>' : '') +
          '<span class="material-symbols-outlined text-[16px] text-outline-variant group-hover:text-primary transition-colors">drag_indicator</span>' +
        '</div>' +
      '</div>';
    var elapsed = fmtDuration(job) || relativeTime(job.createdAt);
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

  var dragHandlers = isQueued
    ? ' ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"'
    : '';

  return '<div class="' + cardClass + '"' + draggableAttr + dragHandlers + ' data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
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

  var dropHandlers = col.id === 'queued'
    ? ' ondragover="handleDragOver(event)" ondrop="handleDrop(event, \'' + col.id + '\')"'
    : '';

  return '<div class="w-[280px] flex-shrink-0 flex flex-col h-full bg-[#181c22] rounded-lg">' +
    '<div class="p-4 flex items-center justify-between border-b border-outline-variant/10">' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-[11px] font-mono ' + col.letterBg + ' px-1.5 py-0.5 rounded ' + col.letterColor + '">' + col.letter + '</span>' +
        '<h3 class="font-headline font-bold text-sm tracking-wide uppercase text-on-surface">' + col.label + '</h3>' +
      '</div>' +
      '<span class="text-xs font-mono text-outline-variant">' + jobs.length + '</span>' +
    '</div>' +
    '<div class="' + listClass + '"' + dropHandlers + ' data-column-id="' + col.id + '">' + cardsHtml + '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Drag & Drop Handlers
   ══════════════════════════════════════════════════════════════ */
var draggedJobId = null;
var draggedJobElement = null;
var queuedJobs = [];

function handleDragStart(event) {
  draggedJobId = event.target.getAttribute('data-job-id');
  draggedJobElement = event.target;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/html', event.target.outerHTML);
  event.target.style.opacity = '0.5';
}

function handleDragEnd(event) {
  event.target.style.opacity = '1';
  draggedJobId = null;
  draggedJobElement = null;
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  var dropZone = event.currentTarget;
  dropZone.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
}

function handleDrop(event, columnId) {
  event.preventDefault();

  var dropZone = event.currentTarget;
  dropZone.style.backgroundColor = '';

  if (!draggedJobId || columnId !== 'queued') return;

  // Calculate drop position
  var afterElement = getDragAfterElement(dropZone, event.clientY);
  var newIndex = getNewIndex(dropZone, afterElement);

  // Optimistically update DOM
  updateQueuedJobsOrder(draggedJobId, newIndex);

  // Update priority via API
  updateJobPriority(draggedJobId, newIndex);
}

function getDragAfterElement(container, y) {
  var draggableElements = Array.from(container.querySelectorAll('[draggable="true"]:not([style*="opacity: 0.5"])'));

  return draggableElements.reduce(function(closest, child) {
    var box = child.getBoundingClientRect();
    var offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getNewIndex(container, afterElement) {
  var cards = Array.from(container.querySelectorAll('[data-job-id]'));
  if (!afterElement) {
    return cards.length;
  }
  return Array.from(cards).indexOf(afterElement);
}

function updateQueuedJobsOrder(jobId, newIndex) {
  // Find job in current queuedJobs and move it to new position
  var jobIndex = queuedJobs.findIndex(function(job) { return job.id === jobId; });
  if (jobIndex === -1) return;

  var job = queuedJobs.splice(jobIndex, 1)[0];
  queuedJobs.splice(newIndex, 0, job);

  // Re-render kanban to reflect new order
  if (typeof allJobs !== 'undefined') {
    var kanbanHtml = renderKanban(allJobs);
    var container = document.getElementById('kanban-board');
    if (container) container.innerHTML = kanbanHtml;
  }
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

  // Sort queued jobs by priority and creation time
  if (columnJobs.queued) {
    queuedJobs = columnJobs.queued.slice(); // Store reference for drag operations
    columnJobs.queued.sort(function(a, b) {
      // Priority order: high -> normal -> low
      var priorityOrder = { high: 3, normal: 2, low: 1 };
      var aPriority = priorityOrder[a.priority] || 1;
      var bPriority = priorityOrder[b.priority] || 1;

      if (aPriority !== bPriority) {
        return bPriority - aPriority; // Higher priority first
      }

      // Same priority: older jobs first
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  return KANBAN_COLUMNS.map(function(col) {
    return renderKanbanColumn(col, columnJobs[col.id]);
  }).join('');
}
