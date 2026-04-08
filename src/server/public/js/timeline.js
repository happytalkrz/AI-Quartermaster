'use strict';

/* ══════════════════════════════════════════════════════════════
   Timeline Modal Management
   ══════════════════════════════════════════════════════════════ */
var timelineModalData = null;

/**
 * Show timeline modal for a specific job
 * @param {string} jobId - Job ID to show timeline for
 */
function showTimelineModal(jobId) {
  if (!jobId) return;

  // Create modal container if it doesn't exist
  var existingModal = document.getElementById('timeline-modal');
  if (existingModal) existingModal.remove();

  // Show loading modal first
  var loadingModalHtml =
    '<div id="timeline-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">' +
      '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-6xl mx-4 border border-outline-variant/20 max-h-[90vh] overflow-auto">' +
        '<div class="flex justify-between items-center mb-6">' +
          '<h3 class="text-xl font-headline font-bold text-on-surface flex items-center gap-3">' +
            '<span class="material-symbols-outlined text-primary">analytics</span>' +
            'Pipeline Timeline' +
          '</h3>' +
          '<button onclick="closeTimelineModal()" class="text-outline hover:text-on-surface transition-colors">' +
            '<span class="material-symbols-outlined">close</span>' +
          '</button>' +
        '</div>' +
        '<div class="flex items-center justify-center py-16 text-outline text-sm">' +
          '<span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>' +
          '타임라인 로딩 중...' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', loadingModalHtml);

  // Fetch timeline data
  apiFetch('/api/jobs/' + encodeURIComponent(jobId) + '/timeline')
    .then(function(r) {
      if (!r.ok) throw new Error('Timeline not found');
      return r.json();
    })
    .then(function(data) {
      timelineModalData = data;
      renderTimelineModal(data);
    })
    .catch(function(error) {
      renderTimelineError(error.message || 'Failed to load timeline');
    });
}

/**
 * Close timeline modal
 */
function closeTimelineModal() {
  var modal = document.getElementById('timeline-modal');
  if (modal) {
    modal.remove();
    timelineModalData = null;
  }
}

/**
 * Render timeline modal with data
 * @param {Object} timelineData - Timeline response data
 */
function renderTimelineModal(timelineData) {
  var modal = document.getElementById('timeline-modal');
  if (!modal) return;

  var timelineHtml = renderTimeline(timelineData);

  var modalContent =
    '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-6xl mx-4 border border-outline-variant/20 max-h-[90vh] overflow-auto">' +
      '<div class="flex justify-between items-center mb-6">' +
        '<div>' +
          '<h3 class="text-xl font-headline font-bold text-on-surface flex items-center gap-3">' +
            '<span class="material-symbols-outlined text-primary">analytics</span>' +
            'Pipeline Timeline' +
          '</h3>' +
          '<div class="mt-2 text-sm text-on-surface-variant">' +
            'Job #' + timelineData.issueNumber + ' — ' + esc(timelineData.repo) +
          '</div>' +
        '</div>' +
        '<button onclick="closeTimelineModal()" class="text-outline hover:text-on-surface transition-colors">' +
          '<span class="material-symbols-outlined">close</span>' +
        '</button>' +
      '</div>' +
      timelineHtml +
    '</div>';

  modal.innerHTML = modalContent;
}

/**
 * Render timeline error state
 * @param {string} errorMessage - Error message to display
 */
function renderTimelineError(errorMessage) {
  var modal = document.getElementById('timeline-modal');
  if (!modal) return;

  var errorHtml =
    '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-6xl mx-4 border border-outline-variant/20">' +
      '<div class="flex justify-between items-center mb-6">' +
        '<h3 class="text-xl font-headline font-bold text-on-surface flex items-center gap-3">' +
          '<span class="material-symbols-outlined text-primary">analytics</span>' +
          'Pipeline Timeline' +
        '</h3>' +
        '<button onclick="closeTimelineModal()" class="text-outline hover:text-on-surface transition-colors">' +
          '<span class="material-symbols-outlined">close</span>' +
        '</button>' +
      '</div>' +
      '<div class="flex items-center justify-center py-16 text-error text-sm">' +
        '<span class="material-symbols-outlined text-lg mr-2">error</span>' +
        esc(errorMessage) +
      '</div>' +
    '</div>';

  modal.innerHTML = errorHtml;
}

/* ══════════════════════════════════════════════════════════════
   Timeline Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * Render timeline Gantt chart
 * @param {Object} timelineData - Timeline response data
 * @returns {string} HTML string for timeline
 */
function renderTimeline(timelineData) {
  if (!timelineData || !timelineData.phases) {
    return '<div class="text-center text-outline py-8">No timeline data available</div>';
  }

  var totalDurationMs = timelineData.totalDurationMs || 0;
  var phases = timelineData.phases || [];

  if (phases.length === 0) {
    return '<div class="text-center text-outline py-8">No phases found</div>';
  }

  // Calculate time axis labels (6 intervals: 0%, 20%, 40%, 60%, 80%, 100%)
  var maxDuration = Math.max(totalDurationMs, 60000); // At least 1 minute
  var timeLabels = [];
  for (var i = 0; i <= 5; i++) {
    var timePoint = (i / 5) * maxDuration;
    timeLabels.push(fmtDurationMs(timePoint));
  }

  // Build summary info
  var summaryHtml = renderTimelineSummary(timelineData);

  // Build legend
  var legendHtml = renderTimelineLegend();

  // Build gantt chart
  var ganttHtml = renderGanttChart(phases, maxDuration, timeLabels);

  return summaryHtml + legendHtml + ganttHtml;
}

/**
 * Render timeline summary section
 * @param {Object} timelineData - Timeline data
 * @returns {string} HTML for summary section
 */
function renderTimelineSummary(timelineData) {
  var totalCost = timelineData.totalCostUsd;
  var totalDuration = fmtDurationMs(timelineData.totalDurationMs);

  return (
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">' +
      '<div class="bg-surface-container p-4 rounded-xl border border-outline-variant/10">' +
        '<div class="flex items-center gap-3 mb-2">' +
          '<span class="material-symbols-outlined text-primary">schedule</span>' +
          '<span class="text-[10px] uppercase text-outline tracking-widest font-bold">Total Duration</span>' +
        '</div>' +
        '<span class="text-2xl font-mono text-on-surface">' + totalDuration + '</span>' +
      '</div>' +
      (totalCost ?
        '<div class="bg-surface-container p-4 rounded-xl border border-outline-variant/10">' +
          '<div class="flex items-center gap-3 mb-2">' +
            '<span class="material-symbols-outlined text-tertiary">payments</span>' +
            '<span class="text-[10px] uppercase text-outline tracking-widest font-bold">Total Cost</span>' +
          '</div>' +
          '<span class="text-2xl font-mono text-tertiary">' + fmtCost(totalCost) + '</span>' +
        '</div>'
        : ''
      ) +
    '</div>'
  );
}

/**
 * Render timeline legend
 * @returns {string} HTML for legend
 */
function renderTimelineLegend() {
  return (
    '<div class="flex justify-end gap-4 text-[10px] font-mono text-outline mb-6">' +
      '<span class="flex items-center gap-1.5">' +
        '<span class="w-2 h-2 rounded-full bg-[#3fb950]"></span>' +
        'SUCCESS' +
      '</span>' +
      '<span class="flex items-center gap-1.5">' +
        '<span class="w-2 h-2 rounded-full bg-[#f85149]"></span>' +
        'FAILED' +
      '</span>' +
      '<span class="flex items-center gap-1.5">' +
        '<span class="w-2 h-2 rounded-full bg-[#58a6ff]"></span>' +
        'RUNNING' +
      '</span>' +
      '<span class="flex items-center gap-1.5">' +
        '<span class="w-2 h-2 rounded-full bg-surface-container-highest"></span>' +
        'PENDING' +
      '</span>' +
    '</div>'
  );
}

/**
 * Render Gantt chart
 * @param {Array} phases - Array of phase objects
 * @param {number} maxDuration - Maximum duration for scaling
 * @param {Array} timeLabels - Time axis labels
 * @returns {string} HTML for Gantt chart
 */
function renderGanttChart(phases, maxDuration, timeLabels) {
  // Build time axis
  var timeAxisHtml =
    '<div class="absolute top-0 left-48 right-0 flex justify-between text-[10px] font-mono text-outline-variant mb-4 border-b border-outline-variant/10 pb-2">' +
      timeLabels.map(function(label) { return '<span>' + esc(label) + '</span>'; }).join('') +
    '</div>';

  // Build grid overlay (using inline style since gantt-grid might not be defined)
  var gridHtml =
    '<div class="absolute top-6 bottom-0 left-48 right-0 pointer-events-none opacity-20" style="background-size: 20% 100%; background-image: linear-gradient(to right, rgba(65, 71, 82, 0.1) 1px, transparent 1px);"></div>';

  // Build phase rows
  var phasesHtml = phases.map(function(phase) {
    return renderPhaseRow(phase, maxDuration);
  }).join('');

  return (
    '<div class="bg-surface-container border border-outline-variant/10 rounded-xl p-6 overflow-hidden relative">' +
      '<div class="relative min-h-[400px]">' +
        timeAxisHtml +
        gridHtml +
        '<div class="pt-10 space-y-6">' + phasesHtml + '</div>' +
      '</div>' +
    '</div>'
  );
}

/**
 * Render individual phase row
 * @param {Object} phase - Phase data
 * @param {number} maxDuration - Maximum duration for scaling
 * @returns {string} HTML for phase row
 */
function renderPhaseRow(phase, maxDuration) {
  var statusColors = {
    success: '#3fb950',
    failure: '#f85149',
    running: '#58a6ff',
    pending: '#8b949e'
  };

  var textColors = {
    success: '#0d1117',
    failure: '#ffffff',
    running: '#0d1117',
    pending: '#ffffff'
  };

  var color = statusColors[phase.status] || statusColors.pending;
  var textColor = textColors[phase.status] || textColors.pending;

  // Calculate bar position and width as percentages
  var leftPercent = (phase.startOffsetMs / maxDuration) * 100;
  var widthPercent = (phase.durationMs / maxDuration) * 100;

  // Ensure minimum visible width for very short phases
  if (widthPercent < 2 && phase.durationMs > 0) {
    widthPercent = 2;
  }

  var duration = fmtDurationMs(phase.durationMs);
  var cost = phase.costUsd ? fmtCost(phase.costUsd) : '';

  // Build tooltip for failed phases
  var tooltipHtml = '';
  if (phase.status === 'failure' && phase.error) {
    tooltipHtml =
      '<div class="absolute -top-12 left-1/2 -translate-x-1/2 bg-error text-on-error px-3 py-1.5 rounded text-[10px] font-bold shadow-xl whitespace-nowrap z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">' +
        '<span class="material-symbols-outlined text-[12px] mr-1">error</span>' +
        esc(phase.error) +
      '</div>';
  }

  var barContent = '';
  if (phase.status === 'pending') {
    barContent =
      '<span class="text-[10px] font-mono text-outline-variant/50 uppercase tracking-widest">' +
        'Awaiting preceding tasks' +
      '</span>';
  } else if (widthPercent >= 10) {
    // Only show content if bar is wide enough
    barContent =
      '<span class="text-[10px] font-bold font-mono" style="color:' + textColor + '">' + duration + '</span>' +
      (cost ? '<span class="text-[10px] font-bold font-mono" style="color:' + textColor + '">' + cost + '</span>' : '');
  }

  var barHtml;
  if (phase.status === 'pending') {
    barHtml =
      '<div class="flex-1 bg-surface-container-high/30 h-10 rounded-md border border-dashed border-outline-variant/20 flex items-center justify-center">' +
        barContent +
      '</div>';
  } else {
    barHtml =
      '<div class="flex-1 bg-surface-container-high h-10 rounded-md relative overflow-hidden">' +
        '<div class="absolute top-0 h-full group/bar cursor-help rounded-sm flex items-center px-3 justify-between relative" ' +
             'style="left:' + leftPercent + '%;width:' + widthPercent + '%;background:' + color + '">' +
          barContent +
          tooltipHtml +
        '</div>' +
      '</div>';
  }

  return (
    '<div class="flex items-center group">' +
      '<div class="w-48 pr-4 text-sm font-medium text-on-surface-variant group-hover:text-on-surface transition-colors">' +
        'Phase ' + phase.phaseIndex + ': ' + esc(phase.phaseName) +
      '</div>' +
      barHtml +
    '</div>'
  );
}

/* ══════════════════════════════════════════════════════════════
   Keyboard Support
   ══════════════════════════════════════════════════════════════ */

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var modal = document.getElementById('timeline-modal');
    if (modal) {
      closeTimelineModal();
    }
  }
});

// Close modal when clicking backdrop
document.addEventListener('click', function(e) {
  var modal = document.getElementById('timeline-modal');
  if (modal && e.target === modal) {
    closeTimelineModal();
  }
});