'use strict';

/* ══════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════ */
var currentJobs = [];
var currentFilter = 'all';
var selectedJobId = null;
var hideArchived = localStorage.getItem('aqm-hide-archived') === 'true';
var currentProject = localStorage.getItem('aqm-current-project') || 'all';
var allProjects = [];
var currentAutomationsView = localStorage.getItem('aqm-automations-view') || 'list';

/* ══════════════════════════════════════════════════════════════
   Filter
   ══════════════════════════════════════════════════════════════ */
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

function toggleArchived() {
  hideArchived = !hideArchived;
  localStorage.setItem('aqm-hide-archived', hideArchived);
  var btn = document.getElementById('hide-archived-toggle');
  if (btn) {
    btn.setAttribute('aria-checked', String(hideArchived));
    if (hideArchived) {
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
  renderFromState();
}

function initArchivedToggle() {
  var btn = document.getElementById('hide-archived-toggle');
  if (!btn) return;
  btn.setAttribute('aria-checked', String(hideArchived));
  if (hideArchived) {
    btn.classList.remove('bg-surface-container-high');
    btn.classList.add('bg-primary');
    btn.querySelector('span').classList.remove('translate-x-0.5');
    btn.querySelector('span').classList.add('translate-x-5');
  }
}

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
