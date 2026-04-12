// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Render Job List Item
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job} job
 * @param {boolean} isSelected
 * @returns {string}
 */
function renderJobListItem(job, isSelected) {
  var color = statusColor(job.status);
  var isRunning = job.status === 'running';
  var dur = fmtDuration(job);
  var relative = relativeTime(job.createdAt);

  var isTablet = false; /* DISABLED: 태블릿 모드 미완성 */
  var expandedClass = (isTablet && isSelected) ? ' job-row-expanded' : '';
  var activeBg = isSelected ? 'bg-surface-container-high border-l-4 border-primary' : 'bg-surface-container-low hover:bg-surface-container';
  var activeRing = isSelected ? 'ring-1 ring-outline-variant/20' : 'ring-1 ring-outline-variant/10';

  var badgeHtml = '';
  if (isRunning) {
    badgeHtml = '<span class="text-[10px] bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/20 px-2 py-0.5 rounded uppercase font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-pulse"></span>Running</span>';
  } else {
    badgeHtml = '<span class="text-[10px] px-2 py-0.5 rounded uppercase font-bold" style="background:' + color + '15;color:' + color + ';border:1px solid ' + color + '33">' + statusLabel(job.status, job) + '</span>';
  }

  var issueTitle = job.issueTitle || '';
  var truncatedTitle = issueTitle.length > 40 ? issueTitle.substring(0, 40) + '...' : issueTitle;

  return '<div class="' + activeBg + expandedClass + ' p-4 rounded-xl ' + activeRing + ' cursor-pointer transition-colors" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
    '<div class="flex justify-between items-start mb-1">' +
      '<div>' +
        '<span class="text-sm font-bold ' + (isSelected ? 'text-on-surface' : 'text-on-surface/80') + '">#' + job.issueNumber + ' ' + esc(job.repo) + '</span>' +
        (truncatedTitle ? '<div class="text-xs text-outline mt-0.5">' + esc(truncatedTitle) + '</div>' : '') +
      '</div>' +
      badgeHtml +
    '</div>' +
    '<div class="flex justify-between items-center">' +
      '<span class="text-xs text-outline font-mono">' + esc(job.id).substring(0, 16) + '</span>' +
      '<span class="text-[10px] text-outline">' + (dur ? dur : relative) + '</span>' +
    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Render Kanban Card
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job} job
 * @returns {string}
 */
function renderKanbanCard(job) {
  var color = statusColor(job.status);
  var isRunning = job.status === 'running';
  var dur = fmtDuration(job);
  var pct = (typeof job.progress === 'number') ? job.progress : 0;
  var isSelected = job.id === selectedJobId;

  var issueTitle = job.issueTitle || '';
  var truncatedTitle = issueTitle.length > 50 ? issueTitle.substring(0, 50) + '...' : issueTitle;

  // Status badge
  var badgeHtml;
  if (isRunning) {
    badgeHtml = '<span class="text-[10px] bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/20 px-1.5 py-0.5 rounded uppercase font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 bg-[#58a6ff] rounded-full animate-pulse"></span>Running</span>';
  } else {
    badgeHtml = '<span class="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold" style="background:' + color + '15;color:' + color + ';border:1px solid ' + color + '33">' + statusLabel(job.status, job) + '</span>';
  }

  // Progress bar
  var progressHtml = '';
  if (pct > 0 || isRunning) {
    var barColor = job.status === 'failure' ? '#f85149' : job.status === 'success' ? '#3fb950' : '#58a6ff';
    var barWidth = job.status === 'success' ? '100' : pct;
    progressHtml = '<div class="h-1 bg-surface-variant rounded-full overflow-hidden mt-2">' +
      '<div class="h-full rounded-full transition-all duration-500' + (isRunning ? ' relative overflow-hidden' : '') + '" style="width:' + barWidth + '%;background:' + barColor + '">' +
      (isRunning ? '<div class="absolute inset-0 shimmer-bar"></div>' : '') +
      '</div></div>';
  }

  var borderStyle = isSelected
    ? 'ring-2 ring-primary border-primary/30'
    : 'ring-1 ring-outline-variant/10 hover:ring-outline-variant/30';
  var bgStyle = isSelected ? 'bg-surface-container-high' : 'bg-surface-container-low hover:bg-surface-container';

  return '<div class="' + bgStyle + ' ' + borderStyle + ' p-3 rounded-xl cursor-pointer transition-colors" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
    '<div class="flex justify-between items-start gap-2">' +
      '<span class="text-xs font-bold text-on-surface/80 shrink-0">#' + job.issueNumber + '</span>' +
      badgeHtml +
    '</div>' +
    (truncatedTitle ? '<div class="text-xs text-on-surface mt-1 leading-snug">' + esc(truncatedTitle) + '</div>' : '') +
    progressHtml +
    '<div class="flex justify-between items-center mt-2">' +
      '<span class="text-[10px] text-outline font-mono truncate">' + esc(job.repo) + '</span>' +
      '<span class="text-[10px] text-outline shrink-0">' + (dur || relativeTime(job.createdAt)) + '</span>' +
    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Render Job Detail
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job|null} job
 * @returns {string}
 */
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
  var costHtml = fmtCost(job.totalCostUsd);
  if (costHtml) html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">payments</span> ' + costHtml + '</span>';
  if (job.cacheHitRatio != null && job.cacheHitRatio > 0) html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">cached</span> Cache: ' + Math.round(job.cacheHitRatio * 100) + '%</span>';
  html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">calendar_today</span> ' + relativeTime(job.createdAt) + '</span>';
  html += '<span class="flex items-center gap-1.5 font-mono text-xs opacity-80">' + esc(job.id) + '</span>';
  html += '</div></div>';

  // Action buttons
  html += '<div class="flex gap-3">';
  if (job.phaseResults && job.phaseResults.length > 0) {
    html += '<button onclick="openTimelineModal(currentJobs.find(function(j){return j.id===\'' + esc(job.id) + '\'})||{})" class="px-4 py-2 bg-surface-container-high text-primary text-sm font-bold rounded-lg border border-primary/30 hover:bg-primary/10 transition-colors flex items-center gap-1.5 whitespace-nowrap"><span class="material-symbols-outlined text-sm">timeline</span> 타임라인</button>';
  }
  if (isActive) {
    html += '<button onclick="cancelJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-[#f85149] text-sm font-bold rounded-lg border border-[#f85149]/30 hover:bg-[#f85149]/10 transition-colors whitespace-nowrap">' + t('cancel') + '</button>';
  }
  if (job.status === 'failure') {
    html += '<button onclick="retryJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-primary text-sm font-bold rounded-lg border border-primary/30 hover:bg-primary/10 transition-colors whitespace-nowrap">' + t('retry') + '</button>';
  }
  if (!isActive) {
    html += '<button onclick="deleteJob(\'' + esc(job.id) + '\')" class="px-4 py-2 bg-surface-container-high text-outline text-sm font-bold rounded-lg border border-outline-variant/30 hover:bg-surface-bright transition-colors whitespace-nowrap">' + t('delete') + '</button>';
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
/**
 * @param {Job} job
 * @returns {string}
 */
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
/**
 * @param {PhaseResultInfo} phase
 * @param {number} i
 * @param {Job} job
 * @returns {string}
 */
function renderPhaseItem(phase, i, job) {
  var isComplete = phase.success !== undefined;
  var isSuccess = phase.success === true;
  var isFailed = phase.success === false;
  var isCurrent = !isComplete && job.status === 'running';
  var dur = phase.durationMs ? fmtDurationMs(phase.durationMs) : '--:--';
  var phaseName = esc(phase.name || 'Phase ' + (i + 1));
  var cost = fmtCost(phase.costUsd);

  // Determine state-specific styles and content
  var containerClass, iconHtml, nameClass, subtitleHtml, durHtml, chevronColor;

  if (isSuccess) {
    containerClass = 'bg-surface-container-low p-4 flex items-center justify-between';
    iconHtml = '<span class="material-symbols-outlined text-[#3fb950]" style="font-variation-settings: \'FILL\' 1;">check_circle</span>';
    nameClass = 'text-sm font-bold';
    subtitleHtml = phase.commit ? '<div class="text-[10px] text-outline font-mono">commit: ' + esc(phase.commit) + '</div>' : '';
    durHtml = '<span class="text-xs font-mono text-outline">' + dur + (cost ? ' • ' + cost : '') + '</span>';
    chevronColor = 'text-outline';
  } else if (isFailed) {
    containerClass = 'bg-surface-container-low p-4 flex items-center justify-between border-l-2 border-[#f85149]';
    iconHtml = '<span class="material-symbols-outlined text-[#f85149]" style="font-variation-settings: \'FILL\' 1;">cancel</span>';
    nameClass = 'text-sm font-bold text-[#f85149]';
    subtitleHtml = phase.error ? '<div class="text-[10px] text-[#f85149]/60 font-mono">' + esc(phase.error).substring(0, 80) + '</div>' : '';
    durHtml = '<span class="text-xs font-mono text-[#f85149]">' + dur + (cost ? ' • ' + cost : '') + '</span>';
    chevronColor = 'text-[#f85149]';
  } else if (isCurrent) {
    containerClass = 'bg-surface-container p-4 flex items-center justify-between ring-1 ring-primary/30 z-10';
    iconHtml = '<div class="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>';
    nameClass = 'text-sm font-bold text-primary';
    subtitleHtml = '';
    durHtml = '<span class="text-xs font-mono text-primary animate-pulse">Running...</span>';
    chevronColor = 'text-primary';
  } else {
    containerClass = 'bg-surface-container-low p-4 flex items-center justify-between opacity-70';
    iconHtml = '<span class="material-symbols-outlined text-outline">pending</span>';
    nameClass = 'text-sm font-bold';
    subtitleHtml = '';
    durHtml = '<span class="text-xs font-mono text-outline">--:--</span>';
    chevronColor = 'text-outline';
  }

  return '<div class="' + containerClass + '">' +
    '<div class="flex items-center gap-4">' +
      iconHtml +
      '<div><div class="' + nameClass + '">' + phaseName + '</div>' + subtitleHtml + '</div>' +
    '</div>' +
    '<div class="flex items-center gap-8">' + durHtml +
      '<span class="material-symbols-outlined ' + chevronColor + ' text-lg">chevron_right</span>' +
    '</div>' +
  '</div>';
}

/**
 * @param {Job} job
 * @returns {string}
 */
function renderPhaseList(job) {
  var phases = job.phaseResults || [];
  if (phases.length === 0) return '';

  var html = '<div class="space-y-px bg-outline-variant/10 rounded-xl overflow-hidden mt-6">';
  phases.forEach(function(phase, i) {
    html += renderPhaseItem(phase, i, job);
  });
  html += '</div>';
  return html;
}

/* ══════════════════════════════════════════════════════════════
   Log Section
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job} job
 * @returns {string}
 */
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
   Accordion Detail Panel (Tablet Mode)
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job} job
 * @returns {string}
 */
function renderAccordionDetail(job) {
  var html = '<div class="accordion-detail">';

  // Metadata row
  html += '<div class="grid grid-cols-2 gap-4 mb-4">';
  html += '<div><span class="text-[10px] uppercase tracking-widest font-bold text-outline">Branch</span>';
  html += '<p class="font-mono text-sm text-on-surface mt-1">' + esc(job.branchName || 'N/A') + '</p></div>';
  html += '<div><span class="text-[10px] uppercase tracking-widest font-bold text-outline">PR</span>';
  if (job.prUrl) {
    html += '<p class="mt-1"><a href="' + esc(job.prUrl) + '" target="_blank" class="text-sm text-primary hover:underline">' + esc(job.prUrl.split('/').pop() || 'Link') + '</a></p>';
  } else {
    html += '<p class="font-mono text-sm text-outline mt-1">—</p>';
  }
  html += '</div>';
  html += '<div><span class="text-[10px] uppercase tracking-widest font-bold text-outline">Cost</span>';
  html += '<p class="font-mono text-sm text-tertiary mt-1">$' + (job.totalCostUsd || job.costUsd || 0).toFixed(4) + '</p></div>';
  if (job.cacheHitRatio != null && job.cacheHitRatio > 0) {
    html += '<div><span class="text-[10px] uppercase tracking-widest font-bold text-outline">Cache</span>';
    html += '<p class="font-mono text-sm text-tertiary mt-1">Cache: ' + Math.round(job.cacheHitRatio * 100) + '%</p></div>';
  }
  html += '<div><span class="text-[10px] uppercase tracking-widest font-bold text-outline">Status</span>';
  html += '<p class="mt-1">' + statusLabel(job.status, job) + '</p></div>';
  html += '</div>';

  // Phase progress
  if (job.phaseResults && job.phaseResults.length > 0) {
    html += '<div class="mb-4">';
    html += '<span class="text-[10px] uppercase tracking-widest font-bold text-outline">Phase Progress</span>';
    html += '<div class="flex items-center gap-2 mt-2 flex-wrap">';
    job.phaseResults.forEach(function(p, i) {
      var icon = p.success ? '<span class="text-[#3fb950]">✓</span>' : '<span class="text-error">✗</span>';
      html += '<span class="text-xs font-mono text-on-surface-variant">' + icon + ' P' + (i + 1) + '</span>';
      // @ts-ignore
      if (i < job.phaseResults.length - 1) html += '<span class="text-outline/30">→</span>';
    });
    html += '</div></div>';
  }

  // Activity log (last 8 lines)
  if (job.logs && job.logs.length > 0) {
    var lines = job.logs.slice(-8);
    html += '<div>';
    html += '<span class="text-[10px] uppercase tracking-widest font-bold text-outline">Telemetry</span>';
    html += '<div class="bg-surface-container-lowest p-3 rounded-lg font-mono text-xs leading-relaxed mt-2 max-h-48 overflow-y-auto custom-scrollbar">';
    lines.forEach(function(line) {
      html += colorizeLogLine(line);
    });
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

/* ══════════════════════════════════════════════════════════════
   Mobile Activity Log Renderer
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job|null} job
 * @returns {void}
 */
function renderMobileActivityLog(job) {
  var container = document.getElementById('mobile-activity-log');
  if (!container) return;

  // Show/hide based on job and viewport width
  /* DISABLED: 태블릿 모드 미완성 */
  container.style.display = 'none';
  return;

  // @ts-ignore
  if (!job.logs || job.logs.length === 0) {
    // @ts-ignore
    container.innerHTML = '<div class="text-outline text-center py-4">이 작업에 대한 활동 로그가 없습니다.</div>';
    return;
  }

  // @ts-ignore
  var maxLines = job.status === 'running' ? 10 : 20;
  // @ts-ignore
  var lines = job.logs.slice(-maxLines);

  var html = '<div class="space-y-3">';
  html += '<div class="flex items-center justify-between">';
  html += '<h3 class="text-xs font-headline font-bold text-outline uppercase tracking-widest">' + t('telemetry') + '</h3>';
  html += '<button onclick="navigateTo(\'logs\')" class="text-[10px] text-primary hover:underline uppercase font-bold">' + t('expandLogs') + '</button>';
  html += '</div>';

  html += '<div class="relative">';
  html += '<div class="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-surface-container to-transparent pointer-events-none z-10 rounded-t-xl"></div>';
  html += '<div class="bg-surface-container-lowest p-4 rounded-xl font-mono text-xs leading-relaxed border border-outline-variant/10 max-h-64 overflow-y-auto custom-scrollbar">';

  lines.forEach(function(line) {
    html += colorizeLogLine(line);
  });

  html += '</div></div></div>';
  // @ts-ignore
  container.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   Logs Full View
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {Job} job
 * @returns {void}
 */
function renderLogsView(job) {
  var container = document.getElementById('logs-detail');

  // Update job selector dropdown
  var selector = /** @type {HTMLSelectElement|null} */ (document.getElementById('logs-job-selector'));
  if (selector && currentJobs) {
    var opts = '<option value="">작업을 선택하세요</option>';
    currentJobs.forEach(function(j) {
      var selected = (job && j.id === job.id) ? ' selected' : '';
      opts += '<option value="' + esc(j.id) + '"' + selected + '>#' + j.issueNumber + ' ' + esc(j.repo) + ' — ' + statusLabel(j.status, j) + '</option>';
    });
    selector.innerHTML = opts;
  }

  // Update status badge and duration
  var statusEl = document.getElementById('logs-job-status');
  var durEl = document.getElementById('logs-job-duration');
  if (job) {
    var color = statusColor(job.status);
    if (statusEl) {
      statusEl.textContent = statusLabel(job.status, job);
      statusEl.style.cssText = 'background:' + color + '15;color:' + color + ';border:1px solid ' + color + '33';
    }
    if (durEl) durEl.textContent = fmtDuration(job) || '';
  } else {
    if (statusEl) { statusEl.textContent = ''; statusEl.style.cssText = ''; }
    if (durEl) durEl.textContent = '';
  }

  if (!job || !job.logs || job.logs.length === 0) {
    // @ts-ignore
    container.innerHTML = '<div class="text-outline text-center py-12">' + (job ? '이 작업에 대한 로그가 없습니다.' : '작업을 선택하세요.') + '</div>';
    return;
  }

  var html = '';
  job.logs.forEach(function(line) {
    html += '<div class="log-line" data-log-text="' + esc(line) + '">' + colorizeLogLine(line) + '</div>';
  });

  // @ts-ignore
  container.innerHTML = html;
  if (logTailEnabled) {
    // @ts-ignore
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * @param {string} jobId
 * @returns {void}
 */
function selectJobFromLogs(jobId) {
  if (!jobId) return;
  selectedJobId = jobId;
  var job = currentJobs.find(function(j) { return j.id === jobId; });
  if (job) renderLogsView(job);
}

/* ══════════════════════════════════════════════════════════════
   Main Render
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {ApiResponse} data
 * @returns {void}
 */
function handleData(data) {
  currentJobs = sortJobs(data.jobs || []);
  render(data);
}

/**
 * @param {ApiResponse} data
 * @returns {void}
 */
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

  // @ts-ignore
  document.getElementById('stat-total').textContent = total;
  // @ts-ignore
  document.getElementById('stat-rate').textContent = rate + '%';
  // @ts-ignore
  document.getElementById('stat-active').textContent = activeCount;
  // @ts-ignore
  document.getElementById('stat-failed').textContent = failedCount;

  renderFromState();

  // Set up drag and drop for kanban priority management
  if (typeof setupDragAndDrop === 'function') {
    setupDragAndDrop();
  }
}

/** @returns {void} */
function renderFromState() {
  var allJobs = currentJobs;
  var filtered = filterJobs(allJobs);

  // Update filter counts
  // @ts-ignore
  document.getElementById('cnt-all').textContent = allJobs.filter(function(j) { return j.status !== 'archived'; }).length;
  // @ts-ignore
  document.getElementById('cnt-running').textContent = allJobs.filter(function(j) { return j.status === 'running'; }).length;
  // @ts-ignore
  document.getElementById('cnt-success').textContent = allJobs.filter(function(j) { return j.status === 'success'; }).length;
  // @ts-ignore
  document.getElementById('cnt-failure').textContent = allJobs.filter(function(j) { return j.status === 'failure'; }).length;
  // @ts-ignore
  document.getElementById('cnt-queued').textContent = allJobs.filter(function(j) { return j.status === 'queued'; }).length;

  var listEl = document.getElementById('job-list');
  var emptyEl = document.getElementById('empty-state');
  var filterEmptyEl = document.getElementById('filter-empty');

  // @ts-ignore
  emptyEl.classList.add('hidden');
  // @ts-ignore
  emptyEl.classList.remove('flex');
  // @ts-ignore
  filterEmptyEl.classList.add('hidden');
  // @ts-ignore
  filterEmptyEl.classList.remove('flex');
  // @ts-ignore
  listEl.classList.remove('hidden');

  if (allJobs.length === 0) {
    // @ts-ignore
    listEl.classList.add('hidden');
    // @ts-ignore
    emptyEl.classList.remove('hidden');
    // @ts-ignore
    emptyEl.classList.add('flex');
    // @ts-ignore
    document.getElementById('job-detail').innerHTML = '<div class="flex items-center justify-center h-full min-h-[300px] text-outline text-sm">' + t('noJobSelected') + '</div>';
    renderMobileActivityLog(null);
    startLiveTickers();
    return;
  }

  if (filtered.length === 0) {
    // @ts-ignore
    listEl.classList.add('hidden');
    // @ts-ignore
    filterEmptyEl.classList.remove('hidden');
    // @ts-ignore
    filterEmptyEl.classList.add('flex');
    startLiveTickers();
    return;
  }

  // Auto-select
  if (!selectedJobId || !filtered.find(function(j) { return j.id === selectedJobId; })) {
    var firstActive = filtered.find(function(j) { return j.status === 'running' || j.status === 'queued'; });
    selectedJobId = (firstActive || filtered[0]).id;
  }

  var isTablet = false; /* DISABLED: 태블릿 모드 미완성 */

  // Render job list (with inline accordion on tablet)
  // @ts-ignore
  listEl.innerHTML = filtered.map(function(j) {
    var isSelected = j.id === selectedJobId;
    var html = renderJobListItem(j, isSelected);
    // Accordion: insert detail panel below selected row on tablet
    if (isTablet && isSelected) {
      html += renderAccordionDetail(j);
    }
    return html;
  }).join('');

  // Render detail panel (desktop only)
  var selectedJob = filtered.find(function(j) { return j.id === selectedJobId; }) || filtered[0];
  if (!isTablet) {
    // @ts-ignore
    document.getElementById('job-detail').innerHTML = renderJobDetail(selectedJob);
  }

  // Render mobile activity log (disabled — accordion replaces it)
  if (!isTablet) renderMobileActivityLog(selectedJob);

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
/**
 * @param {string} id
 * @returns {void}
 */
function selectJob(id) {
  var isTablet = false; /* DISABLED: 태블릿 모드 미완성 */
  // Tablet accordion toggle: clicking same row closes it
  if (isTablet && selectedJobId === id) {
    selectedJobId = null;
  } else {
    selectedJobId = id;
  }
  renderFromState();
}

/* ══════════════════════════════════════════════════════════════
   Live Duration Ticker
   ══════════════════════════════════════════════════════════════ */
/** @type {ReturnType<typeof setInterval>|null} */
var tickerInterval = null;
/** @returns {void} */
function startLiveTickers() {
  // @ts-ignore
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
/** @returns {void} */
function fetchStats() {
  apiFetch(buildStatsUrl())
    .then(function(r) { return r.json(); })
    .then(function(stats) {
      // @ts-ignore
      if (stats.totalJobs !== undefined) document.getElementById('stat-total').textContent = stats.totalJobs;
      // @ts-ignore
      if (stats.successRate !== undefined) document.getElementById('stat-rate').textContent = stats.successRate + '%';
      // @ts-ignore
      if (stats.active !== undefined) document.getElementById('stat-active').textContent = stats.active;
      // @ts-ignore
      if (stats.failed !== undefined) document.getElementById('stat-failed').textContent = stats.failed;
    })
    .catch(function() {});
}

/* ══════════════════════════════════════════════════════════════
   Log Utils
   ══════════════════════════════════════════════════════════════ */
/** @type {boolean} */
var logTailEnabled = true;

/** @returns {void} */
function toggleLogTail() {
  logTailEnabled = !logTailEnabled;
  var btn = document.getElementById('log-tail-btn');
  if (btn) {
    btn.className = logTailEnabled
      ? 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-colors bg-primary/10 text-primary'
      : 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-colors text-outline hover:text-on-surface hover:bg-surface-container-high';
  }
  if (logTailEnabled) {
    var container = document.getElementById('logs-detail');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

/** @returns {void} */
function filterLogs() {
  var input = document.getElementById('log-search');
  // @ts-ignore
  var query = input ? input.value.toLowerCase() : '';
  var lines = document.querySelectorAll('#logs-detail .log-line');
  lines.forEach(function(el) {
    var text = el.getAttribute('data-log-text') || '';
    // @ts-ignore
    el.style.display = (!query || text.toLowerCase().includes(query)) ? '' : 'none';
  });
}
