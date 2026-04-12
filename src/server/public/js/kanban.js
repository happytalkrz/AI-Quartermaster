// @ts-check
'use strict';

/**
 * @typedef {Object} KanbanColumnDef
 * @property {string} id
 * @property {string} label
 * @property {string} letter
 * @property {string} letterColor
 * @property {string} letterBg
 */

/* ══════════════════════════════════════════════════════════════
   Kanban Board — Pipeline Stage Visualization
   ══════════════════════════════════════════════════════════════ */

/** @type {KanbanColumnDef[]} */
var KANBAN_COLUMNS = [
  { id: 'queued',       label: 'Queued',       letter: 'Q', letterColor: 'text-outline',   letterBg: 'bg-surface-container-highest' },
  { id: 'planning',     label: 'Planning',     letter: 'P', letterColor: 'text-primary',   letterBg: 'bg-surface-container-highest' },
  { id: 'implementing', label: 'Implementing', letter: 'I', letterColor: 'text-primary',   letterBg: 'bg-primary-container/20'      },
  { id: 'reviewing',    label: 'Reviewing',    letter: 'R', letterColor: 'text-tertiary',  letterBg: 'bg-surface-container-highest' },
  { id: 'done',         label: 'Done',         letter: 'D', letterColor: 'text-[#3fb950]', letterBg: 'bg-surface-container-highest' },
];

/** @type {Job[]} */
var currentJobs;

/* ══════════════════════════════════════════════════════════════
   Column Mapping
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {Job} job
 * @returns {string}
 */
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
   Card Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {Job} job
 * @returns {string}
 */
function renderKanbanCard(job) {
  var isRunning  = job.status === 'running';
  var isFailed   = job.status === 'failure';
  var isDone     = job.status === 'success' || job.status === 'cancelled' || job.status === 'archived';
  var pct        = typeof job.progress === 'number' ? job.progress : 0;
  var title      = job.issueTitle || (job.repo + ' #' + job.issueNumber);
  var issueRef   = '#' + job.issueNumber;

  var cardClass, headerHtml, bodyHtml;

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
    // queued - add priority-based visual styling
    var priority = job.priority || 'normal';
    var priorityBadge = '';
    var priorityBorder = 'border-[#414752]/15';

    if (priority === 'high') {
      priorityBadge = '<span class="text-[10px] font-mono bg-error text-on-error px-1.5 py-0.5 rounded font-bold">HIGH</span>';
      priorityBorder = 'border-error/30';
    } else if (priority === 'low') {
      priorityBadge = '<span class="text-[10px] font-mono bg-outline-variant text-on-outline-variant px-1.5 py-0.5 rounded font-bold">LOW</span>';
      priorityBorder = 'border-outline-variant/30';
    }

    cardClass = 'bg-[#262a31] p-4 rounded-md border ' + priorityBorder + ' hover:border-primary/40 transition-all cursor-move group';
    headerHtml =
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-outline-variant font-bold tracking-wider">' + esc(issueRef) + '</span>' +
        '<div class="flex items-center gap-2">' +
          priorityBadge +
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

  var isQueued = job.status === 'queued';
  var draggableAttr = isQueued ? ' draggable="true"' : '';
  var onClickAttr = isQueued ? '' : ' onclick="selectJob(\'' + esc(job.id) + '\')"';

  return '<div class="' + cardClass + '" data-job-id="' + esc(job.id) + '"' + draggableAttr + onClickAttr + '>' +
    headerHtml + bodyHtml +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Column Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {KanbanColumnDef} col
 * @param {Job[]} jobs
 * @returns {string}
 */
function renderKanbanColumn(col, jobs) {
  var cardsHtml = jobs.length > 0
    ? jobs.map(renderKanbanCard).join('')
    : '<div class="text-center text-outline text-xs font-mono py-8">EMPTY</div>';

  var listClass = 'flex-1 p-3 space-y-3 overflow-y-auto custom-scrollbar' +
    (col.id === 'done' ? ' opacity-70 hover:opacity-100 transition-opacity' : '');

  return '<div class="w-[280px] flex-shrink-0 flex flex-col h-full bg-[#181c22] rounded-lg">' +
    '<div class="p-4 flex items-center justify-between border-b border-outline-variant/10">' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-[11px] font-mono ' + col.letterBg + ' px-1.5 py-0.5 rounded ' + col.letterColor + '">' + col.letter + '</span>' +
        '<h3 class="font-headline font-bold text-sm tracking-wide uppercase text-on-surface">' + col.label + '</h3>' +
      '</div>' +
      '<span class="text-xs font-mono text-outline-variant">' + jobs.length + '</span>' +
    '</div>' +
    '<div class="' + listClass + '">' + cardsHtml + '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Board Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {Job[]} jobs
 * @returns {string}
 */
function renderKanban(jobs) {
  /** @type {Record<string, Job[]>} */
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
   Drag & Drop Priority Management
   ══════════════════════════════════════════════════════════════ */

/** @type {string | null} */
var draggedJobId = null;

/**
 * @param {string} jobId
 * @param {JobPriority} priority
 * @returns {Promise<unknown>}
 */
function updateJobPriority(jobId, priority) {
  var url = '/api/jobs/' + encodeURIComponent(jobId) + '/priority';
  return apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: priority })
  }).then(function(response) {
    if (!response.ok) {
      throw new Error('Failed to update priority: ' + response.status);
    }
    return response.json();
  });
}

/**
 * @param {string} jobId
 * @param {JobPriority} newPriority
 * @returns {void}
 */
function optimisticUpdatePriority(jobId, newPriority) {
  if (currentJobs) {
    var job = currentJobs.find(function(j) { return j.id === jobId; });
    if (job) {
      var oldPriority = job.priority;
      job.priority = newPriority;

      // Re-render kanban with updated data
      var container = document.getElementById('kanban-container');
      if (container) {
        container.innerHTML = renderKanban(currentJobs);
        setupDragAndDrop(); // Re-attach event listeners
      }

      // Make API call and rollback on failure
      updateJobPriority(jobId, newPriority).catch(function(error) {
        console.error('Failed to update job priority:', error);
        // Rollback
        job.priority = oldPriority;
        var rollbackContainer = document.getElementById('kanban-container');
        if (rollbackContainer) {
          rollbackContainer.innerHTML = renderKanban(currentJobs);
          setupDragAndDrop();
        }
      });
    }
  }
}

/** @returns {void} */
function setupDragAndDrop() {
  // Remove existing listeners to avoid duplicates
  document.removeEventListener('dragstart', handleDragStart);
  document.removeEventListener('dragover', handleDragOver);
  document.removeEventListener('drop', handleDrop);

  // Add event listeners
  document.addEventListener('dragstart', handleDragStart);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
}

/**
 * @param {DragEvent} e
 * @returns {void}
 */
function handleDragStart(e) {
  var target = e.target instanceof Element ? e.target : null;
  var card = /** @type {HTMLElement | null} */ (target ? target.closest('[data-job-id]') : null);
  if (card && card.draggable) {
    draggedJobId = card.dataset.jobId || null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', card.outerHTML);
    }
    card.style.opacity = '0.5';
  }
}

/**
 * @param {DragEvent} e
 * @returns {void}
 */
function handleDragOver(e) {
  e.preventDefault();
  var target = e.target instanceof Element ? e.target : null;
  var dropZone = /** @type {HTMLElement | null} */ (target ? target.closest('[data-job-id]') : null);
  if (dropZone && draggedJobId && dropZone.dataset.jobId !== draggedJobId) {
    var dropJobId = dropZone.dataset.jobId;
    var draggedJob = currentJobs && currentJobs.find(function(j) { return j.id === draggedJobId; });
    var targetJob = currentJobs && currentJobs.find(function(j) { return j.id === dropJobId; });

    // Only allow drops on queued jobs
    if (draggedJob && targetJob && draggedJob.status === 'queued' && targetJob.status === 'queued') {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      dropZone.style.borderColor = '#3b82f6';
    }
  }
}

/**
 * @param {DragEvent} e
 * @returns {void}
 */
function handleDrop(e) {
  e.preventDefault();
  var target = e.target instanceof Element ? e.target : null;
  var dropZone = /** @type {HTMLElement | null} */ (target ? target.closest('[data-job-id]') : null);

  // Reset opacity and border styles
  var draggedCard = /** @type {HTMLElement | null} */ (draggedJobId ? document.querySelector('[data-job-id="' + draggedJobId + '"]') : null);
  if (draggedCard) {
    draggedCard.style.opacity = '';
  }
  if (dropZone) {
    dropZone.style.borderColor = '';
  }

  if (dropZone && draggedJobId && dropZone.dataset.jobId !== draggedJobId) {
    var localDraggedId = draggedJobId;
    var dropJobId = dropZone.dataset.jobId;
    var draggedJob = currentJobs && currentJobs.find(function(j) { return j.id === localDraggedId; });
    var targetJob = currentJobs && currentJobs.find(function(j) { return j.id === dropJobId; });

    // Only allow drops between queued jobs
    if (draggedJob && targetJob && draggedJob.status === 'queued' && targetJob.status === 'queued') {
      var targetPriority = /** @type {JobPriority} */ (targetJob.priority || 'normal');
      optimisticUpdatePriority(localDraggedId, targetPriority);
    }
  }

  draggedJobId = null;
}
