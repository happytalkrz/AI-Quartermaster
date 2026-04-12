// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════ */
/** @type {Job[]} */
var currentJobs = [];
/** @type {string} */
var currentFilter = 'all';
/** @type {string|null} */
var selectedJobId = null;
/** @type {boolean} */
var hideArchived = localStorage.getItem('aqm-hide-archived') === 'true';
/** @type {string} */
var currentProject = localStorage.getItem('aqm-current-project') || 'all';
/** @type {ProjectConfig[]} */
var allProjects = [];
/** @type {string} */
var currentAutomationsView = localStorage.getItem('aqm-automations-view') || 'list';

/* ══════════════════════════════════════════════════════════════
   Filter
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job[]} jobs
 * @returns {Job[]}
 */
function filterJobs(jobs) {
  var filtered = jobs;

  // Apply archived filter
  if (hideArchived) filtered = filtered.filter(function(j) { return j.status !== 'archived'; });

  // Apply project filter
  if (currentProject && currentProject !== 'all') {
    filtered = filtered.filter(function(j) { return j.repo === currentProject; });
  }

  // Apply status filter
  if (currentFilter === 'all') return filtered;
  if (currentFilter === 'running') return filtered.filter(function(j) { return j.status === 'running'; });
  if (currentFilter === 'queued') return filtered.filter(function(j) { return j.status === 'queued'; });
  return filtered.filter(function(j) { return j.status === currentFilter; });
}

/**
 * @param {string} f
 * @returns {void}
 */
function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    var el = /** @type {HTMLElement} */ (btn);
    var isActive = el.dataset.filter === f;
    if (isActive) {
      el.className = 'filter-btn px-3 py-1 text-xs font-bold rounded-md transition-colors bg-primary/10 text-primary';
    } else {
      el.className = 'filter-btn px-3 py-1 text-xs font-bold rounded-md transition-colors text-outline hover:text-on-surface';
    }
  });
  renderFromState();
}

/** @returns {void} */
function toggleArchived() {
  hideArchived = !hideArchived;
  localStorage.setItem('aqm-hide-archived', String(hideArchived));
  var btn = document.getElementById('hide-archived-toggle');
  if (btn) {
    btn.setAttribute('aria-checked', String(hideArchived));
    var span = /** @type {HTMLElement} */ (btn.querySelector('span'));
    if (hideArchived) {
      btn.classList.remove('bg-surface-container-high');
      btn.classList.add('bg-primary');
      span.classList.remove('translate-x-0.5');
      span.classList.add('translate-x-5');
    } else {
      btn.classList.add('bg-surface-container-high');
      btn.classList.remove('bg-primary');
      span.classList.add('translate-x-0.5');
      span.classList.remove('translate-x-5');
    }
  }
  renderFromState();
}

/** @returns {void} */
function initArchivedToggle() {
  var btn = document.getElementById('hide-archived-toggle');
  if (!btn) return;
  btn.setAttribute('aria-checked', String(hideArchived));
  if (hideArchived) {
    btn.classList.remove('bg-surface-container-high');
    btn.classList.add('bg-primary');
    var span = /** @type {HTMLElement} */ (btn.querySelector('span'));
    span.classList.remove('translate-x-0.5');
    span.classList.add('translate-x-5');
  }
}

/**
 * @param {string} projectRepo
 * @returns {void}
 */
function setProject(projectRepo) {
  currentProject = projectRepo;
  localStorage.setItem('aqm-current-project', projectRepo);
  updateProjectDropdownUI();

  // Reload data with new project filter
  apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData).catch(function() {});

  // Reconnect SSE with new project parameter
  if (typeof connectSSE === 'function') {
    connectSSE();
  }

  // Close dropdown
  var dropdown = document.getElementById('project-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

/** @returns {void} */
function updateProjectDropdownUI() {
  var label = document.getElementById('current-project-label');
  if (!label) return;

  if (currentProject === 'all') {
    label.textContent = 'All Projects';
  } else {
    var project = allProjects.find(function(p) { return p.repo === currentProject; });
    label.textContent = project ? project.repo : currentProject;
  }
}
