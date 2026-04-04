'use strict';

/* ══════════════════════════════════════════════════════════════
   Utility Functions
   ══════════════════════════════════════════════════════════════ */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDuration(job) {
  if (!job.startedAt) return null;
  var start = new Date(job.startedAt);
  var end = job.completedAt ? new Date(job.completedAt) : new Date();
  var ms = end - start;
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  var m = Math.floor(ms / 60000);
  var s = Math.floor((ms % 60000) / 1000);
  return m + 'm ' + s + 's';
}

function fmtDurationMs(ms) {
  if (!ms && ms !== 0) return '--:--';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  var m = Math.floor(ms / 60000);
  var s = Math.floor((ms % 60000) / 1000);
  return m + 'm ' + s + 's';
}

function fmtCost(usd) {
  if (usd === undefined || usd === null) return '';
  return '$' + Number(usd).toFixed(4);
}

function relativeTime(iso) {
  if (!iso) return '';
  var diff = Date.now() - new Date(iso).getTime();
  var sec = Math.floor(diff / 1000);
  if (sec < 60) return sec + '초 전';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + '분 전';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + '시간 전';
  var d = Math.floor(hr / 24);
  return d + '일 전';
}

function fmtTime(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  var now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function statusLabel(s, job) {
  if (s === 'queued' && job && job.progress > 0) {
    return currentLang === 'ko' ? '재개 대기' : 'Resuming';
  }
  var map = { queued: 'Queued', running: 'Running', success: 'Success', failure: 'Failed', cancelled: 'Cancelled' };
  return map[s] || s;
}

function statusColor(s) {
  var map = {
    success: '#3fb950',
    failure: '#f85149',
    running: '#58a6ff',
    queued: '#8b949e',
    cancelled: '#8b949e'
  };
  return map[s] || '#8b949e';
}

function sortJobs(jobs) {
  var order = { running: 0, queued: 1, failure: 2, success: 3, cancelled: 4 };
  return [].concat(jobs).sort(function(a, b) {
    var oa = order[a.status] !== undefined ? order[a.status] : 9;
    var ob = order[b.status] !== undefined ? order[b.status] : 9;
    if (oa !== ob) return oa - ob;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

/* ══════════════════════════════════════════════════════════════
   Log Colorizer
   ══════════════════════════════════════════════════════════════ */
function colorizeLogLine(line) {
  var escaped = esc(line);

  // Timestamp pattern: [2026. 3. 28. 18시 25분 41초] or [2026-03-28T18:25:41...]
  var tsPattern = /^(\[[\d., 년월일시분초TZ:+-]+\])/;
  var tsMatch = line.match(tsPattern);

  // Tag colors
  var tagMap = {
    '[HEARTBEAT]': '#58a6ff',
    '[INFO]':      '#3fb950',
    '[PASS]':      '#3fb950',
    '[FAIL]':      '#f85149',
    '[STEP]':      '#58a6ff',
    '[WARN]':      '#d29922',
    '[EXEC]':      '#ffba42',
    '[ERROR]':     '#f85149',
  };

  var lineColor = '#c9d1d9'; // default muted
  var rendered = escaped;

  // Apply timestamp muting
  if (tsMatch) {
    var ts = esc(tsMatch[1]);
    rendered = rendered.replace(ts, '<span style="color:#8b949e">' + ts + '</span>');
  }

  // Apply tag coloring
  var tagEntries = Object.entries(tagMap);
  for (var i = 0; i < tagEntries.length; i++) {
    var tag = tagEntries[i][0];
    var color = tagEntries[i][1];
    if (line.includes(tag)) {
      lineColor = color;
      var escapedTag = esc(tag);
      rendered = rendered.replace(escapedTag, '<span style="color:' + color + ';font-weight:700">' + escapedTag + '</span>');
      break;
    }
  }

  // Fallback: error/pass keywords
  if (lineColor === '#c9d1d9') {
    if (line.includes('실패') || line.includes('ERROR') || line.includes('error')) lineColor = '#f85149';
    else if (line.includes('성공') || line.includes('SUCCESS')) lineColor = '#3fb950';
  }

  return '<div class="mt-0.5 leading-5" style="color:' + lineColor + '">' + rendered + '</div>';
}
