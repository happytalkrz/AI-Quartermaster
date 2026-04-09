'use strict';

/* ══════════════════════════════════════════════════════════════
   Timeline Modal — Gantt Chart
   ══════════════════════════════════════════════════════════════ */

function openTimelineModal(job) {
  var existing = document.getElementById('timeline-modal');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', renderTimelineModal(job));
}

function closeTimelineModal() {
  var modal = document.getElementById('timeline-modal');
  if (modal) modal.remove();
}

function renderTimelineModal(job) {
  var phases = job.phaseResults || [];

  // Calculate total duration: prefer job wall-clock time, fall back to sum of phase durations
  var totalDurationMs = 0;
  if (job.startedAt) {
    var end = job.completedAt ? new Date(job.completedAt) : new Date();
    totalDurationMs = end - new Date(job.startedAt);
  }
  if (totalDurationMs <= 0) {
    phases.forEach(function(p) { totalDurationMs += (p.durationMs || 0); });
  }

  var dur = fmtDuration(job);
  var costHtml = fmtCost(job.totalCostUsd);

  var metaHtml = '';
  if (dur) {
    metaHtml += '<div class="flex flex-col"><span class="text-[10px] uppercase text-outline tracking-widest font-bold">Duration</span>' +
      '<span class="text-lg font-mono text-on-surface">' + esc(dur) + '</span></div>';
  }
  if (costHtml) {
    metaHtml += '<div class="w-px h-8 bg-outline-variant/30"></div>' +
      '<div class="flex flex-col"><span class="text-[10px] uppercase text-outline tracking-widest font-bold">Total Cost</span>' +
      '<span class="text-lg font-mono text-tertiary">' + esc(costHtml) + '</span></div>';
  }

  return '<div id="timeline-modal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick="closeTimelineModal()">' +
    '<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/20 w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar" onclick="event.stopPropagation()">' +

    // Header
    '<div class="flex justify-between items-start p-6 border-b border-outline-variant/10">' +
      '<div>' +
        '<h2 class="font-headline text-xl font-bold flex items-center gap-2">' +
          '<span class="material-symbols-outlined text-primary">analytics</span>' +
          'Pipeline Timeline' +
        '</h2>' +
        '<p class="text-sm text-outline mt-1">#' + esc(String(job.issueNumber)) + ' — ' + esc(job.repo) + '</p>' +
        (metaHtml ? '<div class="flex items-center gap-6 mt-3">' + metaHtml + '</div>' : '') +
      '</div>' +
      '<button onclick="closeTimelineModal()" class="text-outline hover:text-on-surface transition-colors mt-1">' +
        '<span class="material-symbols-outlined">close</span>' +
      '</button>' +
    '</div>' +

    // Gantt body
    '<div class="p-6">' +
      renderGanttChart(phases, totalDurationMs, job.startedAt ? new Date(job.startedAt) : null) +
    '</div>' +

    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Gantt Chart
   ══════════════════════════════════════════════════════════════ */

function renderGanttChart(phases, totalDurationMs, epochStart) {
  if (!phases || phases.length === 0) {
    return '<div class="flex items-center justify-center py-16 text-outline text-sm">' +
      '<span class="material-symbols-outlined text-lg mr-2">hourglass_empty</span>No phase data available</div>';
  }

  // Legend
  var html = '<div class="flex gap-4 text-[10px] font-mono text-outline mb-6">' +
    '<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#3fb950]"></span> SUCCESS</span>' +
    '<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#f85149]"></span> FAILED</span>' +
    '<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#58a6ff]"></span> RUNNING</span>' +
    '<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:#31353c"></span> PENDING</span>' +
    '</div>';

  // X-axis labels
  html += buildXAxis(totalDurationMs);

  // Phase rows with grid overlay
  html += '<div class="relative">';
  // Vertical grid lines (inline style to avoid CSS class dependency)
  html += '<div class="absolute top-0 bottom-0 right-0 pointer-events-none opacity-20" style="left:12rem;' +
    'background-image:linear-gradient(to right,rgba(65,71,82,0.4) 1px,transparent 1px);background-size:16.66% 100%"></div>';

  html += '<div class="space-y-4">';
  var cumulativeMs = 0;
  phases.forEach(function(phase) {
    html += renderGanttPhaseRow(phase, epochStart, cumulativeMs, totalDurationMs);
    cumulativeMs += (phase.durationMs || 0);
  });
  html += '</div>';
  html += '</div>';

  return html;
}

/* ══════════════════════════════════════════════════════════════
   X-Axis
   ══════════════════════════════════════════════════════════════ */

function buildXAxis(totalDurationMs) {
  var TICKS = 6;
  var labels = [];
  for (var i = 0; i < TICKS; i++) {
    var ms = totalDurationMs > 0 ? Math.round((totalDurationMs * i) / (TICKS - 1)) : 0;
    labels.push(fmtDurationMs(ms));
  }

  var html = '<div class="flex justify-between text-[10px] font-mono text-outline-variant pb-2 border-b border-outline-variant/10 mb-4" style="margin-left:12rem">';
  labels.forEach(function(label, i) {
    var cls = i === labels.length - 1 ? ' class="text-primary"' : '';
    html += '<span' + cls + '>' + esc(label) + '</span>';
  });
  html += '</div>';
  return html;
}

/* ══════════════════════════════════════════════════════════════
   Phase Row
   ══════════════════════════════════════════════════════════════ */

function renderGanttPhaseRow(phase, epochStart, fallbackStartMs, totalDurationMs) {
  var phaseName = phase.name || 'Phase';
  var isSuccess = phase.success === true;
  var isFailed = phase.success === false;
  var durationMs = phase.durationMs || 0;
  var hasDuration = durationMs > 0;
  var dur = fmtDurationMs(durationMs);
  var cost = fmtCost(phase.costUsd);

  // Bar position (percentage of total)
  var leftPct, widthPct;
  if (epochStart && phase.startedAt) {
    // Timestamp-based: position bar by actual wall-clock time
    var phaseStartMs = new Date(phase.startedAt) - epochStart;
    leftPct = totalDurationMs > 0 ? (phaseStartMs / totalDurationMs * 100) : 0;
    var phaseWidthMs = phase.completedAt
      ? (new Date(phase.completedAt) - new Date(phase.startedAt))
      : durationMs;
    widthPct = totalDurationMs > 0 ? (phaseWidthMs / totalDurationMs * 100) : 0;
  } else {
    // Fallback: legacy sequential durationMs-based positioning
    leftPct = (totalDurationMs > 0 && fallbackStartMs > 0) ? (fallbackStartMs / totalDurationMs * 100) : 0;
    widthPct = (totalDurationMs > 0 && hasDuration) ? (durationMs / totalDurationMs * 100) : 0;
  }

  // Clamp: always show at least 0.5% width for visible phases
  leftPct = Math.min(Math.max(leftPct, 0), 100);
  if (widthPct > 0) widthPct = Math.max(widthPct, 0.5);
  widthPct = Math.min(widthPct, 100 - leftPct);

  var labelClass;
  if (isSuccess) labelClass = 'text-on-surface-variant';
  else if (isFailed) labelClass = 'text-[#f85149]';
  else if (hasDuration) labelClass = 'text-primary';
  else labelClass = 'text-on-surface-variant opacity-40';

  var html = '<div class="flex items-center group">';

  // Phase label (fixed 12rem width)
  html += '<div class="pr-4 text-sm font-medium ' + labelClass + ' group-hover:text-on-surface transition-colors truncate" style="width:12rem;flex-shrink:0">' +
    esc(phaseName) + '</div>';

  if (isSuccess || isFailed || hasDuration) {
    // Bar track
    html += '<div class="flex-1 h-10 rounded-md relative overflow-visible" style="background:#1c2026">';

    var barColor = isSuccess ? '#3fb950' : isFailed ? '#f85149' : '#58a6ff';
    var textColor = isSuccess ? '#0d1117' : '#ffffff';

    var barStyle = [
      'position:absolute',
      'left:' + leftPct.toFixed(2) + '%',
      'top:0',
      'height:100%',
      'width:' + widthPct.toFixed(2) + '%',
      'background:' + barColor,
      'display:flex',
      'align-items:center',
      'padding:0 8px',
      'justify-content:space-between',
      'border-radius:4px',
      'overflow:hidden',
      'min-width:4px'
    ].join(';');

    html += '<div style="' + barStyle + '" class="relative group/bar cursor-default">';

    // Duration label inside bar
    html += '<span class="text-[10px] font-bold font-mono truncate" style="color:' + textColor + '">' + esc(dur) + '</span>';
    if (cost) {
      html += '<span class="text-[10px] font-bold font-mono" style="color:' + textColor + '">' + esc(cost) + '</span>';
    }

    // Error tooltip (visible on hover)
    if (isFailed && phase.error) {
      var errMsg = String(phase.error).substring(0, 80);
      html += '<div class="absolute bottom-full left-1/2 mb-2 pointer-events-none opacity-0 group-hover/bar:opacity-100 transition-opacity z-20" ' +
        'style="transform:translateX(-50%);white-space:nowrap">' +
        '<div class="px-3 py-1.5 rounded text-[10px] font-bold shadow-xl" style="background:#f85149;color:#fff">' +
          '<span class="material-symbols-outlined mr-1" style="font-size:12px;vertical-align:middle">error</span>' +
          esc(errMsg) +
        '</div>' +
      '</div>';
    }

    html += '</div>'; // bar
    html += '</div>'; // track
  } else {
    // Pending: dashed placeholder
    html += '<div class="flex-1 h-10 rounded-md border border-dashed flex items-center justify-center" ' +
      'style="background:rgba(28,32,38,0.3);border-color:rgba(65,71,82,0.2)">' +
      '<span class="text-[10px] font-mono uppercase tracking-widest" style="color:rgba(139,145,157,0.5)">Awaiting preceding tasks</span>' +
      '</div>';
  }

  html += '</div>'; // row
  return html;
}

// Expose globals for HTML onclick handlers
window.openTimelineModal = openTimelineModal;
window.closeTimelineModal = closeTimelineModal;
