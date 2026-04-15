// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Setup Wizard — Step 5: YAML Diff Preview + Apply
   ══════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} WizardState
 * @property {string} [githubToken]
 * @property {string} repo
 * @property {string} path
 * @property {string} [baseBranch]
 * @property {string[]} [instanceOwners]
 * @property {string[]} [allowedLabels]
 */

/**
 * @typedef {'added' | 'removed' | 'unchanged'} DiffType
 */

/**
 * @typedef {Object} DiffLine
 * @property {DiffType} type
 * @property {string} line
 */

/** @type {WizardState | null} */
var wizardState = null;

/* ── Init ───────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', function () {
  var raw = localStorage.getItem('aqm-wizard-state');
  if (!raw) {
    setStatusError('위자드 상태를 찾을 수 없습니다. Setup을 처음부터 다시 시작하세요.');
    return;
  }
  try {
    wizardState = /** @type {WizardState} */ (JSON.parse(raw));
  } catch (_) {
    setStatusError('위자드 상태 파싱 실패. Setup을 다시 시작하세요.');
    return;
  }
  loadPreview();
});

/* ── API Calls ──────────────────────────────────────────────── */

/**
 * Fetch the YAML preview from the backend and render the diff.
 * @returns {Promise<void>}
 */
async function loadPreview() {
  try {
    var res = await fetch('/api/setup/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wizardState),
    });

    if (!res.ok) {
      /** @type {unknown} */
      var errBody = await res.json().catch(function () { return {}; });
      var apiErr = (errBody && typeof errBody === 'object' && 'error' in errBody)
        ? /** @type {{error: string}} */ (errBody).error
        : 'Preview 로드 실패 (' + res.status + ')';
      setStatusError(apiErr);
      return;
    }

    /** @type {{previewYaml: string, currentYaml: string | null}} */
    var data = await res.json();
    renderDiff(data.currentYaml, data.previewYaml);
  } catch (err) {
    setStatusError('네트워크 오류: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Send the wizard state to the backend to write config.yml and credentials.
 * On success: clear wizard state from localStorage, show toast, redirect to /.
 * @returns {Promise<void>}
 */
async function applyConfig() {
  if (!wizardState) {
    showSetupToast('위자드 상태가 없습니다.', 'error');
    return;
  }

  var applyBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('apply-btn'));
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerHTML =
      '<span class="material-symbols-outlined spin" style="font-size:16px">progress_activity</span> 적용 중...';
  }

  try {
    var res = await fetch('/api/setup/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wizardState),
    });

    if (!res.ok) {
      /** @type {unknown} */
      var errBody = await res.json().catch(function () { return {}; });
      var apiErr = (errBody && typeof errBody === 'object' && 'error' in errBody)
        ? /** @type {{error: string}} */ (errBody).error
        : '적용 실패 (' + res.status + ')';
      throw new Error(apiErr);
    }

    localStorage.removeItem('aqm-wizard-state');
    showSetupToast('설정이 성공적으로 적용되었습니다!', 'success');
    setTimeout(function () {
      window.location.href = '/';
    }, 1500);
  } catch (err) {
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.innerHTML =
        '설정 적용 <span class="material-symbols-outlined" style="font-size:16px">check_circle</span>';
    }
    showSetupToast(err instanceof Error ? err.message : String(err), 'error');
  }
}

/* ── Diff Algorithm ─────────────────────────────────────────── */

/**
 * Compute line-by-line diff via LCS (Longest Common Subsequence).
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {DiffLine[]}
 */
function computeDiff(oldLines, newLines) {
  var m = oldLines.length;
  var n = newLines.length;

  // Build LCS DP table
  /** @type {number[][]} */
  var dp = [];
  for (var ii = 0; ii <= m; ii++) {
    dp.push(new Array(n + 1).fill(0));
  }
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to build diff result
  /** @type {DiffLine[]} */
  var result = [];
  var pi = m, pj = n;
  while (pi > 0 || pj > 0) {
    if (pi > 0 && pj > 0 && oldLines[pi - 1] === newLines[pj - 1]) {
      result.unshift({ type: 'unchanged', line: oldLines[pi - 1] });
      pi--; pj--;
    } else if (pj > 0 && (pi === 0 || dp[pi][pj - 1] >= dp[pi - 1][pj])) {
      result.unshift({ type: 'added', line: newLines[pj - 1] });
      pj--;
    } else {
      result.unshift({ type: 'removed', line: oldLines[pi - 1] });
      pi--;
    }
  }
  return result;
}

/* ── Rendering ──────────────────────────────────────────────── */

/**
 * Render the split diff view from current and proposed YAML strings.
 * @param {string | null} currentYaml
 * @param {string} proposedYaml
 * @returns {void}
 */
function renderDiff(currentYaml, proposedYaml) {
  var currentEl = document.getElementById('current-yaml');
  var proposedEl = document.getElementById('proposed-yaml');
  var diffView = document.getElementById('diff-view');
  var statusEl = document.getElementById('preview-status');
  var applyBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('apply-btn'));
  var footerStatus = document.getElementById('footer-status');

  if (!currentEl || !proposedEl || !diffView) return;

  var proposedLines = proposedYaml.split('\n');

  if (!currentYaml) {
    // No existing config — left: empty state, right: all lines added
    currentEl.innerHTML =
      '<div style="padding:12px 16px;color:rgba(139,145,157,0.4);font-style:italic">' +
      '파일 없음 — 새로 생성됩니다' +
      '</div>';
    proposedEl.innerHTML = proposedLines.map(function (line, idx) {
      return buildLineHtml('added', line, idx + 1);
    }).join('');
  } else {
    var currentLines = currentYaml.split('\n');
    var diff = computeDiff(currentLines, proposedLines);

    var leftHtml = '';
    var rightHtml = '';
    var leftNum = 1;
    var rightNum = 1;

    diff.forEach(function (d) {
      if (d.type !== 'added') {
        leftHtml += buildLineHtml(d.type, d.line, leftNum++);
      }
      if (d.type !== 'removed') {
        rightHtml += buildLineHtml(d.type, d.line, rightNum++);
      }
    });

    currentEl.innerHTML = leftHtml || '<div style="padding:12px 16px;color:rgba(139,145,157,0.4);font-style:italic">내용 없음</div>';
    proposedEl.innerHTML = rightHtml || '<div style="padding:12px 16px;color:rgba(139,145,157,0.4);font-style:italic">내용 없음</div>';
  }

  // Reveal diff view and enable apply button
  if (statusEl) statusEl.classList.add('hidden');
  diffView.classList.remove('hidden');
  if (applyBtn) applyBtn.disabled = false;
  if (footerStatus) footerStatus.textContent = 'READY — 변경 사항을 확인하고 적용하세요';
}

/**
 * Build HTML for a single diff line.
 * @param {DiffType} type
 * @param {string} line
 * @param {number} lineNum
 * @returns {string}
 */
function buildLineHtml(type, line, lineNum) {
  var prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' ';
  var bg = type === 'added'
    ? 'background:rgba(63,185,80,0.08)'
    : type === 'removed'
      ? 'background:rgba(248,81,73,0.08)'
      : '';
  var color = type === 'added'
    ? '#3fb950'
    : type === 'removed'
      ? '#f85149'
      : 'rgba(192,199,212,0.55)';
  var escaped = String(line)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return (
    '<div style="display:flex;align-items:flex-start;gap:8px;padding:1px 8px;' + bg + '">' +
    '<span style="color:rgba(139,145,157,0.35);min-width:28px;text-align:right;user-select:none;flex-shrink:0">' +
    lineNum +
    '</span>' +
    '<span style="color:rgba(139,145,157,0.45);width:10px;user-select:none;flex-shrink:0">' +
    prefix +
    '</span>' +
    '<span style="color:' + color + ';word-break:break-all;white-space:pre-wrap">' +
    escaped +
    '</span>' +
    '</div>'
  );
}

/* ── UI Helpers ─────────────────────────────────────────────── */

/**
 * Show an error in the status bar.
 * @param {string} msg
 * @returns {void}
 */
function setStatusError(msg) {
  var statusEl = document.getElementById('preview-status');
  var footerStatus = document.getElementById('footer-status');
  var escaped = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (statusEl) {
    statusEl.style.background = 'rgba(248,81,73,0.08)';
    statusEl.style.border = '1px solid rgba(248,81,73,0.2)';
    statusEl.style.borderRadius = '0.5rem';
    statusEl.innerHTML =
      '<span class="material-symbols-outlined" style="color:#f85149;font-size:18px">error</span>' +
      '<span style="font-size:13px;color:#f85149">' + escaped + '</span>';
  }
  if (footerStatus) footerStatus.textContent = 'ERROR';
}

/**
 * Show a transient toast notification.
 * @param {string} msg
 * @param {'success' | 'error'} type
 * @returns {void}
 */
function showSetupToast(msg, type) {
  var bg = type === 'success' ? '#3fb950' : '#f85149';
  var textColor = type === 'success' ? '#000' : '#fff';
  var toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:9999;' +
    'background:' + bg + ';color:' + textColor + ';' +
    'padding:12px 20px;border-radius:8px;' +
    'font-weight:700;font-size:13px;font-family:Inter,sans-serif;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.5);' +
    'transition:opacity 0.3s ease;pointer-events:none';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    setTimeout(function () { toast.remove(); }, 300);
  }, 2700);
}
