'use strict';

/* ══════════════════════════════════════════════════════════════
   Render Job List Item
   ══════════════════════════════════════════════════════════════ */
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
  var costHtml = fmtCost(job.totalCostUsd);
  if (costHtml) html += '<span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-sm">payments</span> ' + costHtml + '</span>';
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
    containerClass = 'bg-surface-container-low p-4 flex items-center justify-between opacity-50';
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
function renderMobileActivityLog(job) {
  var container = document.getElementById('mobile-activity-log');
  if (!container) return;

  // Show/hide based on job and viewport width
  /* DISABLED: 태블릿 모드 미완성 */
  container.style.display = 'none';
  return;

  if (!job.logs || job.logs.length === 0) {
    container.innerHTML = '<div class="text-outline text-center py-4">이 작업에 대한 활동 로그가 없습니다.</div>';
    return;
  }

  var maxLines = job.status === 'running' ? 10 : 20;
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
  container.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   Kanban Card
   ══════════════════════════════════════════════════════════════ */
function renderKanbanCard(job) {
  var column = mapJobToKanbanColumn(job);
  var issueNum = '#' + (job.issueNumber || '?');
  var title = esc(job.issueTitle || job.repo || '');
  var elapsed = fmtDuration(job) || '—';
  var pct = (typeof job.progress === 'number') ? job.progress : 0;

  // Done card
  if (column === 'done') {
    var completedTime = relativeTime(job.updatedAt || job.createdAt);
    return '<div class="bg-[#262a31] p-4 rounded-md border border-[#414752]/15 group" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-outline-variant font-bold tracking-wider">' + issueNum + '</span>' +
        '<span class="material-symbols-outlined text-[18px] text-[#3fb950]">check_circle</span>' +
      '</div>' +
      '<h4 class="text-sm font-medium text-on-surface/50 mb-4 leading-snug line-through">' + title + '</h4>' +
      '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
        '<span>COMPLETED</span>' +
        '<span class="text-[#3fb950]">' + completedTime + '</span>' +
      '</div>' +
    '</div>';
  }

  // Implementing — Failed card
  if (column === 'implementing' && job.status === 'failure') {
    var errMsg = job.error ? esc(job.error).substring(0, 40) : 'ERR: FAILED';
    return '<div class="bg-[#262a31] p-4 rounded-md border border-error/20 hover:border-error/40 transition-all cursor-pointer group" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-error/60 font-bold tracking-wider">' + issueNum + '</span>' +
        '<span class="material-symbols-outlined text-[18px] text-error">report</span>' +
      '</div>' +
      '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + title + '</h4>' +
      '<div class="p-2 bg-error-container/20 rounded text-[10px] font-mono text-error mb-4">' + errMsg + '</div>' +
      '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
        '<div class="h-full bg-error rounded-full" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>';
  }

  // Implementing — Running card (pulse animation)
  if (column === 'implementing') {
    return '<div class="bg-[#262a31] p-4 rounded-md border border-[#414752]/30 bg-gradient-to-br from-[#262a31] to-[#1c2026] relative overflow-hidden group" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
      '<div class="absolute top-0 right-0 p-2"><div class="pulse-dot"></div></div>' +
      '<div class="flex justify-between items-start mb-3">' +
        '<span class="text-[10px] font-mono text-primary font-bold tracking-wider">' + issueNum + '</span>' +
      '</div>' +
      '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + title + '</h4>' +
      '<div class="space-y-3">' +
        '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
          '<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[12px] animate-spin">refresh</span> SYNCING</span>' +
          '<span class="text-primary">' + pct + '%</span>' +
        '</div>' +
        '<div class="w-full h-1.5 bg-surface-container-low rounded-full overflow-hidden">' +
          '<div class="h-full bg-gradient-to-r from-primary to-primary-container rounded-full" style="width:' + pct + '%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Queued, Planning, Reviewing — base card
  var progressBarColor = 'bg-outline-variant';
  var progressWidth = 0;
  var issueNumClass = 'text-outline-variant';
  var extraContent = '';

  if (column === 'planning') {
    progressBarColor = 'bg-primary/40';
    progressWidth = pct || 25;
    issueNumClass = 'text-primary';
  } else if (column === 'reviewing') {
    progressBarColor = 'bg-tertiary';
    progressWidth = 100;
    issueNumClass = 'text-outline-variant';
    extraContent = '<span class="material-symbols-outlined text-[16px] text-tertiary mb-4 block">warning</span>';
  }

  return '<div class="bg-[#262a31] p-4 rounded-md border border-[#414752]/15 hover:border-primary/40 transition-all cursor-pointer group" data-job-id="' + esc(job.id) + '" onclick="selectJob(\'' + esc(job.id) + '\')">' +
    '<div class="flex justify-between items-start mb-3">' +
      '<span class="text-[10px] font-mono ' + issueNumClass + ' font-bold tracking-wider">' + issueNum + '</span>' +
      '<span class="material-symbols-outlined text-[16px] text-outline-variant group-hover:text-primary transition-colors">more_horiz</span>' +
    '</div>' +
    '<h4 class="text-sm font-medium text-on-surface mb-4 leading-snug">' + title + '</h4>' +
    extraContent +
    '<div class="space-y-3">' +
      '<div class="flex items-center justify-between text-[10px] font-mono text-outline">' +
        '<span>ELAPSED</span>' +
        '<span class="text-on-surface-variant">' + elapsed + '</span>' +
      '</div>' +
      '<div class="w-full h-1 bg-surface-container-low rounded-full overflow-hidden">' +
        '<div class="h-full ' + progressBarColor + ' rounded-full" style="width:' + progressWidth + '%"></div>' +
      '</div>' +
    '</div>' +
  '</div>';
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
  document.getElementById('cnt-all').textContent = allJobs.filter(function(j) { return j.status !== 'archived'; }).length;
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
    renderMobileActivityLog(null);
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

  var isTablet = false; /* DISABLED: 태블릿 모드 미완성 */

  // Render job list (with inline accordion on tablet)
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
  apiFetch(buildStatsUrl())
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

function renderProjectCard(project) {
  var html = '<div class="bg-surface-container-low p-5 rounded-xl transition-all hover:bg-surface-container flex flex-col justify-between group">';
  html += '<div class="flex justify-between items-start mb-4">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="material-symbols-outlined text-primary text-xl">account_tree</span>';
  html += '<h3 class="font-bold text-on-surface">' + esc(project.repo) + '</h3>';
  html += '</div>';
  html += '<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">';
  if (project.repo) {
    html += '<button onclick="editProject(\'' + esc(project.repo) + '\')" class="p-1 hover:text-primary transition-colors" title="' + (t('edit') || 'Edit') + '">';
    html += '<span class="material-symbols-outlined text-sm">edit</span>';
    html += '</button>';
    html += '<button onclick="deleteProject(\'' + esc(project.repo) + '\')" class="p-1 hover:text-error transition-colors" title="' + t('delete') + '">';
    html += '<span class="material-symbols-outlined text-sm">delete</span>';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  html += '<div class="space-y-3">';
  html += '<div class="flex flex-col">';
  html += '<span class="text-[10px] uppercase text-outline tracking-wider font-bold">' + t('localPath') + '</span>';
  html += '<code class="font-mono text-xs text-on-surface-variant truncate bg-surface-container-highest/30 p-1.5 rounded">' + esc(project.path) + '</code>';
  html += '</div>';

  if (project.baseBranch) {
    html += '<div class="flex justify-between items-end">';
    html += '<div class="flex flex-col">';
    html += '<span class="text-[10px] uppercase text-outline tracking-wider font-bold">' + t('branch') + '</span>';
    html += '<span class="text-sm font-medium">' + esc(project.baseBranch) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  if (project.mode) {
    html += '<div class="flex items-center gap-2 px-2 py-1 rounded-full bg-primary/10 w-fit">';
    html += '<span class="text-[10px] font-bold text-primary uppercase">' + esc(project.mode) + '</span>';
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

function renderSettingsView(config) {
  if (!config) {
    var container = document.getElementById('settings-content');
    if (container) {
      container.innerHTML = '<div class="col-span-full flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정을 불러올 수 없습니다.</div>';
    }
    return;
  }

  // 프로젝트 목록 렌더링
  var container = document.getElementById('settings-content');
  if (container && config.projects && config.projects.length > 0) {
    var html = '';
    config.projects.forEach(function(project) {
      html += renderProjectCard(project);
    });
    container.innerHTML = html;
  }

  // 각 탭별로 폼 렌더링
  renderTabForm('general', config.general);
  renderTabForm('safety', config.safety);
  renderTabForm('review', config.review);

  // 저장된 탭 선택 복원 또는 기본 탭 설정
  var savedTab = localStorage.getItem('aqm-selected-tab') || 'general';
  setSettingsTab(savedTab);
}

function renderTabForm(tabName, data) {
  var container = document.getElementById(tabName + '-settings-form');
  if (!container || !data) return;

  var html = '';

  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      html += renderFormField(key, data[key], tabName + '.' + key);
    }
  }

  container.innerHTML = html;
}

function renderFormField(key, value, configPath) {
  var fieldId = 'field-' + configPath.replace(/\./g, '-');
  var isMasked = typeof value === 'string' && value.includes('********');
  var isReadonly = isMasked;

  var html = '<label class="block">';
  html += '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-2">' + esc(key) + '</span>';

  if (typeof value === 'boolean') {
    html += renderCheckboxInput(fieldId, value, configPath, isReadonly);
  } else if (typeof value === 'number') {
    html += renderNumberInput(fieldId, value, configPath, isReadonly);
  } else if (Array.isArray(value)) {
    html += renderArrayInput(fieldId, value, configPath, isReadonly);
  } else if (typeof value === 'object' && value !== null) {
    html += renderObjectInput(fieldId, value, configPath, isReadonly);
  } else {
    html += renderTextInput(fieldId, String(value), configPath, isReadonly, isMasked);
  }

  html += '</label>';
  return html;
}

function buildInputClasses(baseClasses, isReadonly, additionalClasses) {
  var classes = baseClasses;
  if (isReadonly) classes += ' opacity-60 cursor-not-allowed';
  if (additionalClasses) classes += ' ' + additionalClasses;
  return classes;
}

function renderTextInput(fieldId, value, configPath, isReadonly, isMasked) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none',
    isReadonly,
    isMasked ? 'bg-[#f85149]/5 border-[#f85149]/20 text-[#f85149]' : ''
  );

  return '<input type="text" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'value="' + esc(value) + '" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '/>';
}

function renderNumberInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none',
    isReadonly
  );

  return '<input type="number" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'value="' + value + '" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '/>';
}

function renderCheckboxInput(fieldId, value, configPath, isReadonly) {
  var classes = 'w-4 h-4 text-primary border border-outline-variant/30 rounded focus:ring-1 focus:ring-primary bg-surface-container-highest/40';
  if (isReadonly) {
    classes += ' opacity-60 cursor-not-allowed';
  }

  return '<div class="flex items-center justify-between p-3 bg-surface-container-low rounded-lg">' +
         '<span class="text-sm font-bold">' + (value ? t('enabled') || 'Enabled' : t('disabled') || 'Disabled') + '</span>' +
         '<input type="checkbox" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         (value ? 'checked' : '') + ' ' +
         'class="' + classes + '"' +
         (isReadonly ? ' disabled' : '') + '/>' +
         '</div>';
}

function renderArrayInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none font-mono',
    isReadonly
  );
  var arrayText = JSON.stringify(value, null, 2);

  return '<textarea id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'rows="4" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '>' +
         esc(arrayText) +
         '</textarea>' +
         '<div class="text-[10px] text-outline/50 mt-1">JSON</div>';
}

function renderObjectInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none font-mono',
    isReadonly
  );
  var objectText = JSON.stringify(value, null, 2);

  return '<textarea id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'rows="6" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '>' +
         esc(objectText) +
         '</textarea>' +
         '<div class="text-[10px] text-outline/50 mt-1">JSON</div>';
}

/* ══════════════════════════════════════════════════════════════
   Responsive Activity Log Handler
   ══════════════════════════════════════════════════════════════ */
window.addEventListener('resize', function() {
  // Re-render mobile activity log when window size changes
  if (selectedJobId && currentJobs) {
    var selectedJob = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (selectedJob) {
      renderMobileActivityLog(selectedJob);
    }
  }
});
