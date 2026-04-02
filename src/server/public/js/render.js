'use strict';

/* ══════════════════════════════════════════════════════════════
   Render Job List Item
   ══════════════════════════════════════════════════════════════ */
function renderJobListItem(job, isSelected) {
  var color = statusColor(job.status);
  var isRunning = job.status === 'running';
  var dur = fmtDuration(job);
  var relative = relativeTime(job.createdAt);

  var activeBg = isSelected ? 'bg-surface-container-high border-l-4 border-primary' : 'bg-surface-container-low hover:bg-surface-container';
  var activeRing = isSelected ? 'ring-1 ring-outline-variant/20' : 'ring-1 ring-outline-variant/10';

  var badgeHtml = '';
  if (isRunning) {
    badgeHtml = '<span class="text-[10px] bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/20 px-2 py-0.5 rounded uppercase font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-pulse"></span>Running</span>';
  } else {
    badgeHtml = '<span class="text-[10px] px-2 py-0.5 rounded uppercase font-bold" style="background:' + color + '15;color:' + color + ';border:1px solid ' + color + '33">' + statusLabel(job.status, job) + '</span>';
  }

  return '<div class="' + activeBg + ' p-4 rounded-xl ' + activeRing + ' cursor-pointer transition-colors" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
    '<div class="flex justify-between items-start mb-1">' +
      '<span class="text-sm font-bold ' + (isSelected ? 'text-on-surface' : 'text-on-surface/80') + '">#' + job.issueNumber + ' ' + esc(job.repo) + '</span>' +
      badgeHtml +
    '</div>' +
    '<div class="flex justify-between items-center">' +
      '<span class="text-xs text-outline font-mono">' + esc(job.id).substring(0, 16) + '</span>' +
      '<span class="text-[10px] text-outline">' + (dur ? dur : relative) + '</span>' +
    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Render Job Detail
   ══════════════════════════════════════════════════════════════ */
function renderJobDetail(job) {
  if (!job) {
    return '<div class="flex items-center justify-center h-full min-h-[300px] text-outline text-sm">' + t('noJobSelected') + '</div>';
  }

  var color = statusColor(job.status);
  var isActive = job.status === 'queued' || job.status === 'running';
  var dur = fmtDuration(job);

  // Status badge
  var statusBadge = '';
  if (job.status === 'running') {
    statusBadge = '<span class="px-3 py-1 bg-[#58a6ff]/10 text-[#58a6ff] text-xs font-bold rounded-full ring-1 ring-[#58a6ff]/30 uppercase tracking-tighter">In Progress</span>';
  } else {
    statusBadge = '<span class="px-3 py-1 text-xs font-bold rounded-full uppercase tracking-tighter" style="background:' + color + '15;color:' + color + ';box-shadow:inset 0 0 0 1px ' + color + '44">' + statusLabel(job.status, job) + '</span>';
  }

  // Header
  var html = '<div class="flex justify-between items-start">';
  html += '<div>';
  html += '<div class="flex items-center gap-3 mb-2">';
  html += '<h1 class="text-2xl font-headline font-bold">#' + job.issueNumber + ' ' + esc(job.repo) + '</h1>';
  html += statusBadge;
  html += '</div>';
  html += '<div class="flex items-center gap-6 text-sm text-outline font-medium">';
  if (dur) html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">schedule</span> <span data-dur="' + esc(job.id) + '">' + dur + '</span></span>';
  html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">calendar_today</span> ' + relativeTime(job.createdAt) + '</span>';
  html += '<span class="flex items-center gap-1.5 font-mono text-xs opacity-80">' + esc(job.id) + '</span>';
  html += '</div></div>';

  // Action buttons
  html += '<div class="flex gap-3">';
  if (isActive) {
    html += '<button onclick="cancelJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-[#f85149] text-sm font-bold rounded-lg border border-[#f85149]/30 hover:bg-[#f85149]/10 transition-colors">' + t('cancel') + '</button>';
  }
  if (job.status === 'failure') {
    html += '<button onclick="retryJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-primary text-sm font-bold rounded-lg border border-primary/30 hover:bg-primary/10 transition-colors">' + t('retry') + '</button>';
  }
  if (!isActive) {
    html += '<button onclick="deleteJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-outline text-sm font-bold rounded-lg border border-outline-variant/30 hover:bg-surface-bright transition-colors">' + t('delete') + '</button>';
  }
  html += '</div></div>';

  // Phase progress bar
  html += renderPhaseProgress(job);

  // Phase list
  html += renderPhaseList(job);

  // PR link
  if (job.prUrl) {
    html += '<div class="mt-2"><a href="' + esc(job.prUrl) + '" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-4 py-2 bg-[#3fb950]/10 text-[#3fb950] text-sm font-bold rounded-lg border border-[#3fb950]/30 hover:bg-[#3fb950]/20 transition-colors">';
    html += '<span class="material-symbols-outlined text-sm">open_in_new</span> ' + t('prLink') + '</a></div>';
  }

  // Error box
  if (job.error) {
    html += '<div class="mt-4 p-4 bg-[#f85149]/5 border border-[#f85149]/20 rounded-xl font-mono text-xs text-[#ffa198] leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto custom-scrollbar">' + esc(job.error) + '</div>';
  }

  // Current step
  if (job.status === 'running' && job.currentStep) {
    html += '<div class="flex items-center gap-2 mt-4 text-sm text-primary font-mono"><div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>' + esc(job.currentStep) + '</div>';
  }

  // Log viewer
  html += renderLogSection(job);

  return html;
}

/* ══════════════════════════════════════════════════════════════
   Phase Progress Bar
   ══════════════════════════════════════════════════════════════ */
function renderPhaseProgress(job) {
  var pct = (typeof job.progress === 'number') ? job.progress : 0;

  var html = '<div class="space-y-4 mt-6">';
  html += '<div class="flex justify-between text-xs font-headline font-bold text-outline uppercase tracking-widest">';
  html += '<span>' + t('pipeline') + '</span>';
  if (job.status === 'success') {
    html += '<span class="text-[#3fb950]">' + t('complete') + '</span>';
  } else if (job.status === 'failure') {
    html += '<span class="text-[#f85149]">' + t('failed') + ' (' + pct + '%)</span>';
  } else {
    html += '<span class="text-primary">' + pct + '% ' + t('complete') + '</span>';
  }
  html += '</div>';

  // Single smooth progress bar based on job.progress
  html += '<div class="h-2.5 bg-surface-variant rounded-full overflow-hidden">';
  if (job.status === 'failure') {
    html += '<div class="h-full bg-[#f85149] rounded-full transition-all duration-500" style="width:' + pct + '%"></div>';
  } else if (job.status === 'success') {
    html += '<div class="h-full bg-[#3fb950] rounded-full" style="width:100%"></div>';
  } else if (pct > 0) {
    html += '<div class="h-full bg-primary rounded-full transition-all duration-500 relative overflow-hidden" style="width:' + pct + '%">';
    html += '<div class="absolute inset-0 shimmer-bar"></div>';
    html += '</div>';
  }
  html += '</div></div>';

  return html;
}

/* ══════════════════════════════════════════════════════════════
   Phase List
   ══════════════════════════════════════════════════════════════ */
function renderPhaseList(job) {
  var phases = job.phaseResults || [];
  if (phases.length === 0) return '';

  var html = '<div class="space-y-px bg-outline-variant/10 rounded-xl overflow-hidden mt-6">';

  phases.forEach(function(phase, i) {
    var isComplete = phase.success !== undefined;
    var isSuccess = phase.success === true;
    var isFailed = phase.success === false;
    var isCurrent = !isComplete && job.status === 'running';
    var dur = phase.durationMs ? fmtDurationMs(phase.durationMs) : '--:--';

    if (isSuccess) {
      html += '<div class="bg-surface-container-low p-4 flex items-center justify-between">';
      html += '<div class="flex items-center gap-4">';
      html += '<span class="material-symbols-outlined text-[#3fb950]" style="font-variation-settings: \'FILL\' 1;">check_circle</span>';
      html += '<div><div class="text-sm font-bold">' + esc(phase.name || 'Phase ' + (i + 1)) + '</div>';
      if (phase.commit) html += '<div class="text-[10px] text-outline font-mono">commit: ' + esc(phase.commit) + '</div>';
      html += '</div></div>';
      html += '<div class="flex items-center gap-8"><span class="text-xs font-mono text-outline">' + dur + '</span>';
      html += '<span class="material-symbols-outlined text-outline text-lg">chevron_right</span></div></div>';
    } else if (isFailed) {
      html += '<div class="bg-surface-container-low p-4 flex items-center justify-between border-l-2 border-[#f85149]">';
      html += '<div class="flex items-center gap-4">';
      html += '<span class="material-symbols-outlined text-[#f85149]" style="font-variation-settings: \'FILL\' 1;">cancel</span>';
      html += '<div><div class="text-sm font-bold text-[#f85149]">' + esc(phase.name || 'Phase ' + (i + 1)) + '</div>';
      if (phase.error) html += '<div class="text-[10px] text-[#f85149]/60 font-mono">' + esc(phase.error).substring(0, 80) + '</div>';
      html += '</div></div>';
      html += '<div class="flex items-center gap-8"><span class="text-xs font-mono text-[#f85149]">' + dur + '</span>';
      html += '<span class="material-symbols-outlined text-[#f85149] text-lg">chevron_right</span></div></div>';
    } else if (isCurrent) {
      html += '<div class="bg-surface-container p-4 flex items-center justify-between ring-1 ring-primary/30 z-10">';
      html += '<div class="flex items-center gap-4">';
      html += '<div class="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>';
      html += '<div><div class="text-sm font-bold text-primary">' + esc(phase.name || 'Phase ' + (i + 1)) + '</div>';
      html += '</div></div>';
      html += '<div class="flex items-center gap-8"><span class="text-xs font-mono text-primary animate-pulse">Running...</span>';
      html += '<span class="material-symbols-outlined text-primary text-lg">chevron_right</span></div></div>';
    } else {
      html += '<div class="bg-surface-container-low p-4 flex items-center justify-between opacity-50">';
      html += '<div class="flex items-center gap-4">';
      html += '<span class="material-symbols-outlined text-outline">pending</span>';
      html += '<div><div class="text-sm font-bold">' + esc(phase.name || 'Phase ' + (i + 1)) + '</div></div></div>';
      html += '<div class="flex items-center gap-8"><span class="text-xs font-mono text-outline">--:--</span>';
      html += '<span class="material-symbols-outlined text-outline text-lg">chevron_right</span></div></div>';
    }
  });

  html += '</div>';
  return html;
}

/* ══════════════════════════════════════════════════════════════
   Log Section
   ══════════════════════════════════════════════════════════════ */
function renderLogSection(job) {
  if (!job.logs || job.logs.length === 0) return '';

  var maxLines = job.status === 'running' ? 10 : 20;
  var lines = job.logs.slice(-maxLines);

  var html = '<div class="space-y-3 mt-6">';
  html += '<div class="flex items-center justify-between">';
  html += '<h3 class="text-xs font-headline font-bold text-outline uppercase tracking-widest">' + t('telemetry') + '</h3>';
  html += '<button onclick="navigateTo(\'logs\')" class="text-[10px] text-primary hover:underline uppercase font-bold">' + t('expandLogs') + '</button>';
  html += '</div>';

  html += '<div class="relative">';
  html += '<div class="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-surface-container-lowest to-transparent pointer-events-none z-10 rounded-t-xl"></div>';
  html += '<div class="bg-surface-container-lowest p-6 rounded-xl font-mono text-xs leading-relaxed border border-outline-variant/10 max-h-64 overflow-y-auto custom-scrollbar" id="detail-log-box">';

  lines.forEach(function(line) {
    html += colorizeLogLine(line);
  });

  html += '</div></div></div>';
  return html;
}

/* ══════════════════════════════════════════════════════════════
   Logs Full View
   ══════════════════════════════════════════════════════════════ */
function renderLogsView(job) {
  var container = document.getElementById('logs-detail');
  if (!job || !job.logs || job.logs.length === 0) {
    container.innerHTML = '<div class="text-outline text-center py-12">이 작업에 대한 로그가 없습니다.</div>';
    return;
  }

  var html = '<div class="mb-4 text-sm text-on-surface font-bold">#' + job.issueNumber + ' ' + esc(job.repo) + ' — ' + statusLabel(job.status, job) + '</div>';

  job.logs.forEach(function(line) {
    html += colorizeLogLine(line);
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════
   Main Render
   ══════════════════════════════════════════════════════════════ */
function handleData(data) {
  currentJobs = sortJobs(data.jobs || []);
  render(data);
}

function render(data) {
  currentJobs = sortJobs(data.jobs || []);
  var q = data.queue || {};

  // Stats from /api/stats or computed (exclude archived from counts)
  var activeJobs = currentJobs.filter(function(j) { return j.status !== 'archived'; });
  var total = activeJobs.length;
  var successCount = activeJobs.filter(function(j) { return j.status === 'success'; }).length;
  var failedCount = activeJobs.filter(function(j) { return j.status === 'failure'; }).length;
  var activeCount = activeJobs.filter(function(j) { return j.status === 'running'; }).length;
  var completed = successCount + failedCount;
  var rate = completed > 0 ? ((successCount / completed) * 100).toFixed(1) : '0';

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-rate').textContent = rate + '%';
  document.getElementById('stat-active').textContent = activeCount;
  document.getElementById('stat-failed').textContent = failedCount;

  renderFromState();
}

function renderFromState() {
  var allJobs = currentJobs;
  var filtered = filterJobs(allJobs);

  // Update filter counts
  document.getElementById('cnt-all').textContent = allJobs.length;
  document.getElementById('cnt-running').textContent = allJobs.filter(function(j) { return j.status === 'running'; }).length;
  document.getElementById('cnt-success').textContent = allJobs.filter(function(j) { return j.status === 'success'; }).length;
  document.getElementById('cnt-failure').textContent = allJobs.filter(function(j) { return j.status === 'failure'; }).length;
  document.getElementById('cnt-queued').textContent = allJobs.filter(function(j) { return j.status === 'queued'; }).length;

  var listEl = document.getElementById('job-list');
  var emptyEl = document.getElementById('empty-state');
  var filterEmptyEl = document.getElementById('filter-empty');

  emptyEl.classList.add('hidden');
  emptyEl.classList.remove('flex');
  filterEmptyEl.classList.add('hidden');
  filterEmptyEl.classList.remove('flex');
  listEl.classList.remove('hidden');

  if (allJobs.length === 0) {
    listEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    emptyEl.classList.add('flex');
    document.getElementById('job-detail').innerHTML = '<div class="flex items-center justify-center h-full min-h-[300px] text-outline text-sm">' + t('noJobSelected') + '</div>';
    startLiveTickers();
    return;
  }

  if (filtered.length === 0) {
    listEl.classList.add('hidden');
    filterEmptyEl.classList.remove('hidden');
    filterEmptyEl.classList.add('flex');
    startLiveTickers();
    return;
  }

  // Auto-select
  if (!selectedJobId || !filtered.find(function(j) { return j.id === selectedJobId; })) {
    var firstActive = filtered.find(function(j) { return j.status === 'running' || j.status === 'queued'; });
    selectedJobId = (firstActive || filtered[0]).id;
  }

  // Render job list
  listEl.innerHTML = filtered.map(function(j) { return renderJobListItem(j, j.id === selectedJobId); }).join('');

  // Render detail
  var selectedJob = filtered.find(function(j) { return j.id === selectedJobId; }) || filtered[0];
  document.getElementById('job-detail').innerHTML = renderJobDetail(selectedJob);

  // Auto-scroll log
  var lb = document.getElementById('detail-log-box');
  if (lb) lb.scrollTop = lb.scrollHeight;

  // Update logs view if active
  if (currentView === 'logs' && selectedJob) {
    renderLogsView(selectedJob);
  }

  startLiveTickers();
}

/* ══════════════════════════════════════════════════════════════
   Select Job
   ══════════════════════════════════════════════════════════════ */
function selectJob(id) {
  selectedJobId = id;
  renderFromState();
}

/* ══════════════════════════════════════════════════════════════
   Live Duration Ticker
   ══════════════════════════════════════════════════════════════ */
var tickerInterval = null;
function startLiveTickers() {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(function() {
    currentJobs.filter(function(j) { return j.status === 'running'; }).forEach(function(job) {
      var dur = fmtDuration(job);
      if (!dur) return;
      document.querySelectorAll('[data-dur="' + CSS.escape(job.id) + '"]').forEach(function(el) {
        el.textContent = dur;
      });
    });
  }, 1000);
}

/* ══════════════════════════════════════════════════════════════
   Fetch Stats
   ══════════════════════════════════════════════════════════════ */
function fetchStats() {
  apiFetch('/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(stats) {
      if (stats.totalJobs !== undefined) document.getElementById('stat-total').textContent = stats.totalJobs;
      if (stats.successRate !== undefined) document.getElementById('stat-rate').textContent = stats.successRate + '%';
      if (stats.active !== undefined) document.getElementById('stat-active').textContent = stats.active;
      if (stats.failed !== undefined) document.getElementById('stat-failed').textContent = stats.failed;
    })
    .catch(function() {});
}

/* ══════════════════════════════════════════════════════════════
   Settings Rendering
   ══════════════════════════════════════════════════════════════ */
function renderSettings(config) {
  var html = '';

  // Configuration sections
  var sections = [
    { key: 'general', title: 'General', icon: 'settings', data: config.general },
    { key: 'git', title: 'Git', icon: 'account_tree', data: config.git },
    { key: 'worktree', title: 'Worktree', icon: 'folder_managed', data: config.worktree },
    { key: 'commands', title: 'Commands', icon: 'terminal', data: config.commands },
    { key: 'review', title: 'Review', icon: 'rate_review', data: config.review },
    { key: 'pr', title: 'Pull Request', icon: 'merge', data: config.pr },
    { key: 'safety', title: 'Safety', icon: 'security', data: config.safety }
  ];

  sections.forEach(function(section) {
    html += renderConfigSection(section.key, section.title, section.icon, section.data);
  });

  // Projects section
  if (config.projects && config.projects.length > 0) {
    html += '<div class="bg-surface-container rounded-xl ring-1 ring-outline-variant/20">';
    html += '<div class="flex items-center gap-3 p-6 border-b border-outline-variant/20">';
    html += '<span class="material-symbols-outlined text-primary">inventory_2</span>';
    html += '<h3 class="text-lg font-headline font-bold text-on-surface">Projects</h3>';
    html += '<span class="text-xs text-outline bg-surface-container-high px-2 py-1 rounded-full">' + config.projects.length + '</span>';
    html += '</div>';
    html += '<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">';
    config.projects.forEach(function(project) {
      html += renderProjectCard(project);
    });
    html += '</div></div>';
  }

  return html;
}

function renderConfigSection(key, title, icon, data) {
  var sectionId = 'section-' + key;
  var isExpanded = localStorage.getItem('aqm-section-' + key) !== 'collapsed';
  var expandClass = isExpanded ? 'expanded' : 'collapsed';
  var contentClass = isExpanded ? 'block' : 'hidden';
  var iconClass = isExpanded ? 'rotate-180' : '';

  var html = '<div class="bg-surface-container rounded-xl ring-1 ring-outline-variant/20">';
  html += '<div class="flex items-center gap-3 p-6 cursor-pointer" onclick="toggleSection(\'' + key + '\')">';
  html += '<span class="material-symbols-outlined text-primary">' + icon + '</span>';
  html += '<h3 class="text-lg font-headline font-bold text-on-surface flex-1">' + title + '</h3>';
  html += '<span class="material-symbols-outlined text-outline transform transition-transform ' + iconClass + '" id="icon-' + key + '">expand_more</span>';
  html += '</div>';

  html += '<div id="content-' + key + '" class="' + contentClass + ' border-t border-outline-variant/20">';
  html += '<div class="p-6 space-y-4">';

  // Render key-value pairs
  if (data && typeof data === 'object') {
    for (var prop in data) {
      if (data.hasOwnProperty(prop)) {
        html += renderConfigProperty(prop, data[prop]);
      }
    }
  }

  html += '</div></div></div>';
  return html;
}

function renderConfigProperty(key, value) {
  var html = '<div class="flex flex-col sm:flex-row sm:items-center gap-3 py-2">';
  html += '<span class="text-sm font-bold text-on-surface/80 font-mono min-w-[140px]">' + esc(key) + '</span>';
  html += '<div class="flex-1">';

  if (value === null || value === undefined) {
    html += '<span class="text-xs text-outline italic">null</span>';
  } else if (typeof value === 'boolean') {
    var color = value ? 'text-[#3fb950]' : 'text-outline';
    html += '<span class="text-sm font-bold ' + color + '">' + String(value) + '</span>';
  } else if (typeof value === 'number') {
    html += '<span class="text-sm font-mono text-primary">' + value + '</span>';
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      html += '<span class="text-xs text-outline italic">empty array</span>';
    } else {
      html += '<div class="space-y-1">';
      value.forEach(function(item, i) {
        html += '<div class="text-sm font-mono bg-surface-container-low px-2 py-1 rounded border border-outline-variant/20">';
        html += '<span class="text-outline text-xs mr-2">' + i + ':</span>' + esc(String(item));
        html += '</div>';
      });
      html += '</div>';
    }
  } else if (typeof value === 'object') {
    html += '<div class="bg-surface-container-low p-3 rounded-lg border border-outline-variant/20">';
    html += '<pre class="text-xs font-mono text-on-surface/80 leading-relaxed">' + esc(JSON.stringify(value, null, 2)) + '</pre>';
    html += '</div>';
  } else {
    var displayValue = String(value);
    if (displayValue.includes('********')) {
      html += '<span class="text-sm font-mono bg-[#f85149]/10 text-[#f85149] px-2 py-1 rounded border border-[#f85149]/20">' + esc(displayValue) + '</span>';
    } else {
      html += '<span class="text-sm font-mono bg-surface-container-low px-2 py-1 rounded border border-outline-variant/20">' + esc(displayValue) + '</span>';
    }
  }

  html += '</div></div>';
  return html;
}

function renderProjectCard(project) {
  var html = '<div class="bg-surface-container-low p-4 rounded-lg ring-1 ring-outline-variant/10">';
  html += '<div class="flex items-start justify-between mb-3">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="material-symbols-outlined text-primary text-sm">folder</span>';
  html += '<span class="text-sm font-bold text-on-surface">' + esc(project.repo) + '</span>';
  html += '</div>';
  if (project.mode) {
    html += '<span class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded uppercase font-bold">' + esc(project.mode) + '</span>';
  }
  html += '</div>';

  html += '<div class="text-xs text-outline font-mono mb-2">' + esc(project.path) + '</div>';

  if (project.baseBranch) {
    html += '<div class="text-xs text-outline flex items-center gap-1 mb-1">';
    html += '<span class="material-symbols-outlined text-xs">account_tree</span>';
    html += 'Base: ' + esc(project.baseBranch);
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function toggleSection(key) {
  var content = document.getElementById('content-' + key);
  var icon = document.getElementById('icon-' + key);
  var isCollapsed = content.classList.contains('hidden');

  if (isCollapsed) {
    content.classList.remove('hidden');
    content.classList.add('block');
    icon.classList.add('rotate-180');
    localStorage.setItem('aqm-section-' + key, 'expanded');
  } else {
    content.classList.remove('block');
    content.classList.add('hidden');
    icon.classList.remove('rotate-180');
    localStorage.setItem('aqm-section-' + key, 'collapsed');
  }
}

function renderSettingsView(config) {
  var container = document.getElementById('settings-content');
  if (!config) {
    container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정을 불러올 수 없습니다.</div>';
    return;
  }

  container.innerHTML = renderSettings(config);
}
