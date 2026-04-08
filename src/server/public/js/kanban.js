'use strict';

/* ══════════════════════════════════════════════════════════════
   Kanban Board
   ══════════════════════════════════════════════════════════════ */

// Inject card fade-in keyframe once
(function() {
  var styleId = 'kanban-styles';
  if (document.getElementById(styleId)) return;
  var style = document.createElement('style');
  style.id = styleId;
  style.textContent = '@keyframes kanban-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }';
  document.head.appendChild(style);
}());

var KANBAN_COLUMNS = [
  { id: 'queued',       label: 'Queued',       badge: 'Q', colorClass: 'text-outline' },
  { id: 'planning',     label: 'Planning',     badge: 'P', colorClass: 'text-primary' },
  { id: 'implementing', label: 'Implementing', badge: 'I', colorClass: 'text-primary' },
  { id: 'reviewing',    label: 'Reviewing',    badge: 'R', colorClass: 'text-tertiary' },
  { id: 'done',         label: 'Done',         badge: 'D', colorClass: 'text-[#3fb950]' }
];

/**
 * Groups jobs by kanban column.
 * @param {object[]} jobs
 * @returns {Object.<string, object[]>}
 */
function groupJobsByColumn(jobs) {
  var groups = {};
  KANBAN_COLUMNS.forEach(function(col) { groups[col.id] = []; });
  jobs.forEach(function(job) {
    var col = mapJobToKanbanColumn(job);
    if (groups[col]) {
      groups[col].push(job);
    }
  });
  return groups;
}

/**
 * Renders a single kanban column.
 * @param {{ id: string, label: string, badge: string, colorClass: string }} col
 * @param {object[]} jobs
 * @returns {string}
 */
function renderKanbanColumn(col, jobs) {
  var count = jobs.length;
  var cards = jobs.map(function(job) { return renderKanbanCard(job); }).join('');

  var emptyHtml = count === 0
    ? '<div class="flex flex-col items-center justify-center py-8 text-outline-variant">' +
        '<span class="material-symbols-outlined text-[32px] mb-2 opacity-30">inbox</span>' +
        '<span class="text-[10px] font-mono tracking-wider opacity-40">EMPTY</span>' +
      '</div>'
    : '';

  return '<div class="w-[280px] flex-shrink-0 flex flex-col bg-[#181c22] rounded-lg" style="max-height:100%">' +
    '<div class="p-4 flex items-center justify-between border-b border-outline-variant/10">' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-[11px] font-mono bg-surface-container-highest px-1.5 py-0.5 rounded ' + col.colorClass + '">' + col.badge + '</span>' +
        '<h3 class="font-headline font-bold text-sm tracking-wide uppercase text-on-surface">' + col.label + '</h3>' +
      '</div>' +
      '<span class="text-xs font-mono text-outline-variant">' + count + '</span>' +
    '</div>' +
    '<div class="flex-1 p-3 space-y-3 overflow-y-auto custom-scrollbar">' +
      (cards || emptyHtml) +
    '</div>' +
  '</div>';
}

/**
 * Renders the full kanban board with 5 columns.
 * @param {object[]} jobs - All jobs to display
 * @returns {string} HTML string
 */
function renderKanbanBoard(jobs) {
  var groups = groupJobsByColumn(jobs);

  var columns = KANBAN_COLUMNS.map(function(col) {
    return renderKanbanColumn(col, groups[col.id]);
  }).join('');

  return '<div class="flex gap-6 h-full overflow-x-auto custom-scrollbar px-1 pb-1">' +
    columns +
  '</div>';
}

/**
 * Filters jobs for the kanban board (project + archived filter, no status filter).
 * @returns {object[]}
 */
function getKanbanJobs() {
  var jobs = currentJobs.filter(function(j) { return j.status !== 'archived'; });
  if (currentProject && currentProject !== 'all') {
    jobs = jobs.filter(function(j) { return j.repo === currentProject; });
  }
  return jobs;
}

/**
 * Updates the kanban board DOM with current job state.
 * Triggers a card fade-in animation on each update.
 */
function updateKanbanBoard() {
  var kanbanEl = document.getElementById('kanban-board');
  if (!kanbanEl) return;

  kanbanEl.innerHTML = renderKanbanBoard(getKanbanJobs());

  kanbanEl.querySelectorAll('[data-job-id]').forEach(function(card) {
    card.style.animation = 'kanban-card-in 0.25s ease-out';
  });
}
