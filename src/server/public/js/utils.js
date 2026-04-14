// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Utility Functions
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {unknown} str
 * @returns {string}
 */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {Job} job
 * @returns {string | null}
 */
function fmtDuration(job) {
  if (!job.startedAt) return null;
  var start = new Date(job.startedAt);
  var end = job.completedAt ? new Date(job.completedAt) : new Date();
  var ms = end.getTime() - start.getTime();
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  var m = Math.floor(ms / 60000);
  var s = Math.floor((ms % 60000) / 1000);
  return m + 'm ' + s + 's';
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
function fmtDurationMs(ms) {
  if (ms == null) return '--:--';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  var m = Math.floor(ms / 60000);
  var s = Math.floor((ms % 60000) / 1000);
  return m + 'm ' + s + 's';
}

/**
 * @param {number | null | undefined} usd
 * @returns {string}
 */
function fmtCost(usd) {
  if (usd === undefined || usd === null) return '';
  return '$' + Number(usd).toFixed(4);
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
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

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
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

/**
 * @param {string} s
 * @param {Job} [job]
 * @returns {string}
 */
function statusLabel(s, job) {
  if (s === 'queued' && job && job.progress !== undefined && job.progress > 0) {
    return currentLang === 'ko' ? '재개 대기' : 'Resuming';
  }
  /** @type {Record<string, string>} */
  var map = { queued: 'Queued', running: 'Running', success: 'Success', failure: 'Failed', cancelled: 'Cancelled' };
  return map[s] || s;
}

/**
 * @param {string} s
 * @returns {string}
 */
function statusColor(s) {
  /** @type {Record<string, string>} */
  var map = {
    success: '#3fb950',
    failure: '#f85149',
    running: '#58a6ff',
    queued: '#8b949e',
    cancelled: '#8b949e'
  };
  return map[s] || '#8b949e';
}

/**
 * @param {Job[]} jobs
 * @returns {Job[]}
 */
function sortJobs(jobs) {
  /** @type {{[key: string]: number | undefined}} */
  var order = { running: 0, queued: 1, failure: 2, success: 3, cancelled: 4 };
  return jobs.slice().sort(function(a, b) {
    var oa = order[a.status] !== undefined ? /** @type {number} */ (order[a.status]) : 9;
    var ob = order[b.status] !== undefined ? /** @type {number} */ (order[b.status]) : 9;
    if (oa !== ob) return oa - ob;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/* ══════════════════════════════════════════════════════════════
   DOM Type Guard Helpers
   ══════════════════════════════════════════════════════════════ */
/**
 * querySelector with null check — returns HTMLElement or null.
 * Eliminates @ts-ignore on querySelector + property access patterns.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement | null}
 */
function $el(selector, root) {
  var r = root || document;
  return /** @type {HTMLElement | null} */ (r.querySelector(selector));
}

/**
 * querySelectorAll wrapper typed as HTMLElement array.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
function $$el(selector, root) {
  var r = root || document;
  return /** @type {HTMLElement[]} */ (Array.from(r.querySelectorAll(selector)));
}

/**
 * getElementById with HTMLElement cast.
 * Eliminates @ts-ignore on getElementById + property access patterns.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function $id(id) {
  return /** @type {HTMLElement | null} */ (document.getElementById(id));
}

/**
 * Cast element to HTMLInputElement for value/checked access.
 * @param {Element | HTMLElement | null} el
 * @returns {HTMLInputElement | null}
 */
function asInput(el) {
  if (el instanceof HTMLInputElement) return el;
  return null;
}

/**
 * Cast element to HTMLSelectElement for value access.
 * @param {Element | HTMLElement | null} el
 * @returns {HTMLSelectElement | null}
 */
function asSelect(el) {
  if (el instanceof HTMLSelectElement) return el;
  return null;
}

/**
 * Cast element to HTMLFormElement for FormData access.
 * @param {Element | HTMLElement | null} el
 * @returns {HTMLFormElement | null}
 */
function asForm(el) {
  if (el instanceof HTMLFormElement) return el;
  return null;
}

/* ══════════════════════════════════════════════════════════════
   Toast Notifications
   ══════════════════════════════════════════════════════════════ */
/**
 * Show a toast notification in the top-right corner.
 * @param {string} message
 * @param {'error' | 'success'} [type]
 */
function showToast(message, type) {
  var container = $id('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'aqm-toast aqm-toast-' + (type || 'error');
  toast.textContent = message;
  toast.style.pointerEvents = 'auto';
  container.appendChild(toast);

  // Auto-dismiss after 5 seconds
  var timer = setTimeout(function() { removeToast(toast); }, 5000);

  toast.addEventListener('click', function() {
    clearTimeout(timer);
    removeToast(toast);
  });
}

/**
 * @param {HTMLElement} toast
 */
function removeToast(toast) {
  toast.classList.add('aqm-toast-out');
  setTimeout(function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 300);
}

/**
 * Extract error message from a fetch Response or Error and show a toast.
 * @param {unknown} error
 * @param {string} fallbackMessage
 * @returns {Promise<void>}
 */
async function handleMutationError(error, fallbackMessage) {
  if (error instanceof Response) {
    var msg = fallbackMessage;
    try {
      /** @type {unknown} */
      var body = await error.json();
      if (body && typeof body === 'object' && 'error' in body && typeof (/** @type {{error:unknown}} */(body)).error === 'string') {
        msg = (/** @type {{error:string}} */(body)).error + ' (' + error.status + ')';
      } else {
        msg = fallbackMessage + ' (' + error.status + ')';
      }
    } catch (_) {
      msg = fallbackMessage + ' (' + error.status + ')';
    }
    showToast(msg, 'error');
  } else if (error instanceof Error) {
    showToast(error.message || fallbackMessage, 'error');
  } else {
    showToast(fallbackMessage, 'error');
  }
}

/* ══════════════════════════════════════════════════════════════
   Log Colorizer
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {string} line
 * @returns {string}
 */
function colorizeLogLine(line) {
  var escaped = esc(line);

  // Timestamp pattern: [2026. 3. 28. 18시 25분 41초] or [2026-03-28T18:25:41...]
  var tsPattern = /^(\[[\d., 년월일시분초TZ:+-]+\])/;
  var tsMatch = line.match(tsPattern);

  // Tag colors
  /** @type {Record<string, string>} */
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
