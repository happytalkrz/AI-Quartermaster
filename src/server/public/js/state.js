'use strict';

/* ══════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════ */
var currentJobs = [];
var currentFilter = 'all';
var selectedJobId = null;
var hideArchived = localStorage.getItem('aqm-hide-archived') === 'true';
var logsSearchText = '';
var logsLevelFilter = localStorage.getItem('aqm-logs-level-filter') === 'true';

/* ══════════════════════════════════════════════════════════════
   Filter
   ══════════════════════════════════════════════════════════════ */
function filterJobs(jobs) {
  var filtered = jobs;
  if (hideArchived) filtered = filtered.filter(function(j) { return j.status !== 'archived'; });
  if (currentFilter === 'all') return filtered;
  if (currentFilter === 'running') return filtered.filter(function(j) { return j.status === 'running'; });
  if (currentFilter === 'queued') return filtered.filter(function(j) { return j.status === 'queued'; });
  return filtered.filter(function(j) { return j.status === currentFilter; });
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    var isActive = btn.dataset.filter === f;
    if (isActive) {
      btn.className = 'filter-btn px-3 py-1 text-xs font-bold rounded-md transition-colors bg-primary/10 text-primary';
    } else {
      btn.className = 'filter-btn px-3 py-1 text-xs font-bold rounded-md transition-colors text-outline hover:text-on-surface';
    }
  });
  renderFromState();
}

function updateToggleButtonState(btnId, isEnabled) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.setAttribute('aria-checked', String(isEnabled));
  if (isEnabled) {
    btn.classList.remove('bg-surface-container-high');
    btn.classList.add('bg-primary');
    btn.querySelector('span').classList.remove('translate-x-0.5');
    btn.querySelector('span').classList.add('translate-x-5');
  } else {
    btn.classList.add('bg-surface-container-high');
    btn.classList.remove('bg-primary');
    btn.querySelector('span').classList.add('translate-x-0.5');
    btn.querySelector('span').classList.remove('translate-x-5');
  }
}

function toggleArchived() {
  hideArchived = !hideArchived;
  localStorage.setItem('aqm-hide-archived', hideArchived);
  updateToggleButtonState('hide-archived-toggle', hideArchived);
  renderFromState();
}

function initArchivedToggle() {
  updateToggleButtonState('hide-archived-toggle', hideArchived);
}

/* ══════════════════════════════════════════════════════════════
   Logs Search and Filter
   ══════════════════════════════════════════════════════════════ */
function setLogsSearchText(text) {
  logsSearchText = text;
  // Trigger logs re-render if currently viewing logs
  if (currentView === 'logs' && selectedJobId) {
    var job = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (job) renderLogsView(job);
  }
}

function toggleLogsLevelFilter() {
  logsLevelFilter = !logsLevelFilter;
  localStorage.setItem('aqm-logs-level-filter', logsLevelFilter);
  updateToggleButtonState('logs-level-filter-toggle', logsLevelFilter);
  if (currentView === 'logs' && selectedJobId) {
    var job = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (job) renderLogsView(job);
  }
}

function initLogsLevelFilterToggle() {
  updateToggleButtonState('logs-level-filter-toggle', logsLevelFilter);
}
