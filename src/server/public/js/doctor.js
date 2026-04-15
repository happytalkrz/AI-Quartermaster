// @ts-check
'use strict';

/**
 * @typedef {Object} DoctorCheck
 * @property {string} id
 * @property {string} name
 * @property {'pass'|'warn'|'fail'|'pending'} status
 * @property {1|2|3} healLevel
 * @property {string[]} [autoFixCommand]
 * @property {string[]} [healCommand]
 * @property {string} [guide]
 * @property {string} [docsUrl]
 */

/** @type {DoctorCheck[]} */
var doctorChecks = [];

/** @type {string | null} */
var doctorCurrentHealId = null;

/** @type {AbortController | null} */
var doctorHealAbortController = null;

/* ══════════════════════════════════════════════════════════════
   Load & Render
   ══════════════════════════════════════════════════════════════ */

/** @returns {void} */
function loadDoctorChecks() {
  var listEl = $id('doctor-checks-list');
  if (!listEl) return;

  listEl.innerHTML =
    '<div class="flex items-center justify-center py-12 text-outline text-sm">' +
      '<span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>검사 중...' +
    '</div>';
  doctorUpdateRing(null, 0, 0);

  apiFetch('/api/doctor/checks')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      /** @type {{checks?: DoctorCheck[]}} */
      var result = /** @type {any} */ (data);
      doctorChecks = result.checks || [];
      var lastRun = $id('doctor-last-run');
      if (lastRun) {
        var now = new Date().toLocaleString('ko-KR', { hour12: false });
        lastRun.innerHTML =
          '<span class="w-2 h-2 rounded-full bg-primary/60 animate-pulse inline-block mr-2"></span>최종 검사: ' + now;
      }
      renderDoctorChecks();
    })
    .catch(function(err) {
      if (listEl) {
        listEl.innerHTML =
          '<div class="flex items-center justify-center py-12 text-error text-sm">' +
            '<span class="material-symbols-outlined text-lg mr-2">error</span>검사 목록을 불러오지 못했습니다.' +
          '</div>';
      }
      showToast((err instanceof Error ? err.message : '검사 목록 로드 실패'), 'error');
    });
}

/** @returns {void} */
function renderDoctorChecks() {
  var listEl = $id('doctor-checks-list');
  if (!listEl) return;

  if (doctorChecks.length === 0) {
    listEl.innerHTML =
      '<div class="flex items-center justify-center py-12 text-outline text-sm">검사 항목이 없습니다.</div>';
    doctorUpdateRing(null, 0, 0);
    return;
  }

  var pass = doctorChecks.filter(function(c) { return c.status === 'pass'; }).length;
  var issues = doctorChecks.filter(function(c) { return c.status === 'fail' || c.status === 'warn'; }).length;
  doctorUpdateRing(pass, doctorChecks.length, issues);

  listEl.innerHTML = doctorChecks.map(function(check) {
    return renderDoctorCheckRow(check);
  }).join('');
}

/**
 * @param {number | null} pass
 * @param {number} total
 * @param {number} issues
 * @returns {void}
 */
function doctorUpdateRing(pass, total, issues) {
  var label = $id('doctor-ring-label');
  var sublabel = $id('doctor-ring-sublabel');
  var ringFill = $id('doctor-ring-fill');

  if (pass === null) {
    if (label) label.textContent = '—';
    if (sublabel) sublabel.textContent = '';
    if (ringFill) ringFill.setAttribute('stroke-dashoffset', '301.6');
    return;
  }

  if (label) label.textContent = pass + '/' + total;
  if (sublabel) sublabel.textContent = issues > 0 ? '조치 필요 ' + issues + '건' : '정상';

  var circumference = 301.6;
  var ratio = total > 0 ? pass / total : 0;
  var offset = circumference * (1 - ratio);
  if (ringFill) {
    ringFill.setAttribute('stroke-dashoffset', String(Math.round(offset * 10) / 10));
    /** @type {HTMLElement} */ (ringFill).className =
      (issues > 0 ? 'text-tertiary' : 'text-primary') + ' transition-all duration-700';
  }
}

/**
 * @param {DoctorCheck} check
 * @returns {string}
 */
function renderDoctorCheckRow(check) {
  return (
    '<div id="check-row-' + esc(check.id) + '" class="bg-surface-container-high p-4 rounded-lg flex items-center justify-between group hover:bg-surface-bright transition-all duration-200">' +
      '<div class="flex items-center gap-4 min-w-0">' +
        doctorStatusIcon(check.status) +
        '<div class="min-w-0">' +
          '<div class="font-bold text-on-surface text-sm">' + esc(check.name) + '</div>' +
          '<div id="check-detail-' + esc(check.id) + '" class="text-xs font-mono text-outline/70 uppercase tracking-wide">' +
            doctorStatusDetail(check) +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="check-action-' + esc(check.id) + '" class="flex gap-2 shrink-0 ml-4">' +
        doctorCheckAction(check) +
      '</div>' +
    '</div>'
  );
}

/**
 * @param {'pass'|'warn'|'fail'|'pending'} status
 * @returns {string}
 */
function doctorStatusIcon(status) {
  if (status === 'pass') {
    return '<span class="material-symbols-outlined text-primary shrink-0" style="font-variation-settings:\'FILL\' 1">check_circle</span>';
  }
  if (status === 'fail') {
    return '<span class="material-symbols-outlined text-error shrink-0" style="font-variation-settings:\'FILL\' 1">cancel</span>';
  }
  if (status === 'warn') {
    return '<span class="material-symbols-outlined text-tertiary shrink-0" style="font-variation-settings:\'FILL\' 1">warning</span>';
  }
  return '<span class="material-symbols-outlined text-outline shrink-0 animate-spin">sync</span>';
}

/**
 * @param {DoctorCheck} check
 * @returns {string}
 */
function doctorStatusDetail(check) {
  if (check.status === 'pass') return 'OK';
  if (check.status === 'pending') return '검사 대기 중';
  if (check.status === 'warn') return 'WARNING';
  return 'FAIL';
}

/**
 * @param {DoctorCheck} check
 * @returns {string}
 */
function doctorCheckAction(check) {
  if (check.status === 'pass' || check.status === 'pending') return '';

  if (check.healLevel === 1) {
    return (
      '<button onclick="doctorHealLevel1(\'' + esc(check.id) + '\')" ' +
        'class="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-primary/20 transition-all">' +
        '<span class="material-symbols-outlined text-xs">auto_fix_high</span> 자동 복구' +
      '</button>'
    );
  }
  if (check.healLevel === 2) {
    return (
      '<button onclick="doctorOpenHealModal(\'' + esc(check.id) + '\')" ' +
        'class="flex items-center gap-1.5 bg-surface-container-highest text-on-surface border border-outline-variant/30 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-surface-bright transition-all">' +
        '<span class="material-symbols-outlined text-xs">terminal</span> 복구' +
      '</button>'
    );
  }
  // healLevel === 3
  return (
    '<button onclick="doctorOpenGuidePanel(\'' + esc(check.id) + '\')" ' +
      'class="flex items-center gap-1.5 bg-surface-container-highest text-on-surface border border-outline-variant/30 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-surface-bright transition-all">' +
      '<span class="material-symbols-outlined text-xs">menu_book</span> 가이드' +
    '</button>'
  );
}

/* ══════════════════════════════════════════════════════════════
   Level1: Auto-fix (JSON response)
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string} id
 * @returns {void}
 */
function doctorHealLevel1(id) {
  var actionEl = $id('check-action-' + id);
  var detailEl = $id('check-detail-' + id);
  var rowEl = $id('check-row-' + id);

  if (actionEl) {
    actionEl.innerHTML =
      '<span class="text-xs text-outline flex items-center gap-1">' +
        '<span class="material-symbols-outlined text-sm animate-spin">sync</span> 복구 중...' +
      '</span>';
  }

  apiFetch('/api/doctor/heal/' + encodeURIComponent(id), { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      /** @type {{success?: boolean, output?: string, error?: string}} */
      var result = /** @type {any} */ (data);
      var success = result.success === true;

      // Update icon in row
      if (rowEl) {
        var iconEl = /** @type {HTMLElement|null} */ (rowEl.querySelector('.material-symbols-outlined'));
        if (iconEl) {
          iconEl.textContent = success ? 'check_circle' : 'cancel';
          iconEl.className = 'material-symbols-outlined shrink-0 ' + (success ? 'text-primary' : 'text-error');
          iconEl.style.fontVariationSettings = "'FILL' 1";
          iconEl.classList.remove('animate-spin');
        }
      }

      if (detailEl) {
        detailEl.textContent = success
          ? 'OK — 복구 완료'
          : ('복구 실패: ' + (result.output || result.error || ''));
      }

      if (actionEl) {
        if (success) {
          actionEl.innerHTML =
            '<span class="text-xs text-primary flex items-center gap-1">' +
              '<span class="material-symbols-outlined text-sm">check</span> 완료' +
            '</span>';
          var check = doctorChecks.find(function(c) { return c.id === id; });
          if (check) check.status = 'pass';
          var pass = doctorChecks.filter(function(c) { return c.status === 'pass'; }).length;
          var issues = doctorChecks.filter(function(c) { return c.status === 'fail' || c.status === 'warn'; }).length;
          doctorUpdateRing(pass, doctorChecks.length, issues);
        } else {
          actionEl.innerHTML =
            '<button onclick="doctorHealLevel1(\'' + esc(id) + '\')" ' +
              'class="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-primary/20 transition-all">' +
              '<span class="material-symbols-outlined text-xs">refresh</span> 재시도' +
            '</button>';
        }
      }
    })
    .catch(function(err) {
      if (actionEl) {
        actionEl.innerHTML =
          '<button onclick="doctorHealLevel1(\'' + esc(id) + '\')" ' +
            'class="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-md text-xs font-bold hover:bg-primary/20 transition-all">' +
            '<span class="material-symbols-outlined text-xs">refresh</span> 재시도' +
          '</button>';
      }
      showToast((err instanceof Error ? err.message : '복구 실패'), 'error');
    });
}

/** @returns {void} */
function doctorRunAllLevel1() {
  var targets = doctorChecks.filter(function(c) {
    return (c.status === 'fail' || c.status === 'warn') && c.healLevel === 1;
  });
  if (targets.length === 0) {
    showToast('자동 복구 가능한 항목이 없습니다', 'error');
    return;
  }
  targets.forEach(function(c) { doctorHealLevel1(c.id); });
}

/* ══════════════════════════════════════════════════════════════
   Level2: SSE Heal Modal
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string} id
 * @returns {void}
 */
function doctorOpenHealModal(id) {
  var check = doctorChecks.find(function(c) { return c.id === id; });
  if (!check) return;

  doctorCurrentHealId = id;

  var modal = $id('doctor-heal-modal');
  var output = $id('doctor-heal-output');
  var cursor = $id('doctor-heal-cursor');
  var titleEl = $id('doctor-modal-title');
  var descEl = $id('doctor-modal-desc');
  var statusEl = $id('doctor-modal-status');
  var recheckBtn = /** @type {HTMLButtonElement|null} */ ($id('doctor-modal-recheck-btn'));

  if (titleEl) titleEl.textContent = check.name + ' 복구';
  if (descEl) descEl.textContent = check.guide || '복구 스크립트를 실행합니다.';
  if (output) output.innerHTML = '';
  if (cursor) cursor.classList.remove('hidden');
  if (statusEl) {
    statusEl.innerHTML =
      '<span class="material-symbols-outlined text-sm animate-spin">sync</span> 복구 중...';
  }
  if (recheckBtn) recheckBtn.disabled = true;

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  if (doctorHealAbortController) doctorHealAbortController.abort();
  doctorHealAbortController = new AbortController();
  var signal = doctorHealAbortController.signal;

  apiFetch('/api/doctor/heal/' + encodeURIComponent(id), { method: 'POST', signal: signal })
    .then(function(response) {
      if (!response.body) throw new Error('응답 스트림이 없습니다');
      return doctorReadSSEStream(response.body, output, cursor, statusEl, recheckBtn);
    })
    .catch(function(err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (output) doctorAppendHealLine(output, 'ERROR: ' + (err instanceof Error ? err.message : '스트림 오류'), 'error');
      if (statusEl) {
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-sm text-error">error</span> 오류 발생';
      }
      if (cursor) cursor.classList.add('hidden');
      if (recheckBtn) recheckBtn.disabled = false;
    });
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {HTMLElement|null} output
 * @param {HTMLElement|null} cursor
 * @param {HTMLElement|null} statusEl
 * @param {HTMLButtonElement|null} recheckBtn
 * @returns {Promise<void>}
 */
function doctorReadSSEStream(body, output, cursor, statusEl, recheckBtn) {
  var reader = body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';

  /** @param {string} chunk */
  function processBuffer(chunk) {
    buffer += chunk;
    var parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    parts.forEach(function(part) {
      if (!part.trim()) return;
      var lines = part.split('\n');
      var event = 'message';
      /** @type {string[]} */
      var dataLines = [];
      lines.forEach(function(line) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      });
      if (dataLines.length === 0) return;
      try {
        /** @type {unknown} */
        var parsed = JSON.parse(dataLines.join('\n'));
        doctorHandleSSEEvent(event, parsed, output, cursor, statusEl, recheckBtn);
      } catch (_) { /* ignore JSON parse errors */ }
    });
  }

  /** @returns {Promise<void>} */
  function pump() {
    return reader.read().then(function(result) {
      if (result.done) return Promise.resolve();
      processBuffer(decoder.decode(result.value, { stream: true }));
      return pump();
    });
  }

  return pump();
}

/**
 * @param {string} event
 * @param {unknown} data
 * @param {HTMLElement|null} output
 * @param {HTMLElement|null} cursor
 * @param {HTMLElement|null} statusEl
 * @param {HTMLButtonElement|null} recheckBtn
 * @returns {void}
 */
function doctorHandleSSEEvent(event, data, output, cursor, statusEl, recheckBtn) {
  if (!data || typeof data !== 'object') return;

  if (event === 'data') {
    var dobj = /** @type {{type?: string, line?: string}} */ (data);
    var line = dobj.line || '';
    if (output) doctorAppendHealLine(output, line, dobj.type === 'stderr' ? 'stderr' : 'stdout');
  } else if (event === 'status') {
    var sobj = /** @type {{status?: string}} */ (data);
    if (statusEl) {
      if (sobj.status === 'running') {
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-sm animate-spin">sync</span> 복구 중...';
      } else if (sobj.status === 'success') {
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-sm text-primary">check_circle</span> 복구 완료';
      } else if (sobj.status === 'error') {
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-sm text-error">error</span> 복구 실패';
      }
    }
  } else if (event === 'done') {
    var done = /** @type {{success?: boolean}} */ (data);
    if (cursor) cursor.classList.add('hidden');
    if (recheckBtn) recheckBtn.disabled = false;
    if (done.success && doctorCurrentHealId) {
      var check = doctorChecks.find(function(c) { return c.id === doctorCurrentHealId; });
      if (check) check.status = 'pass';
      var pass = doctorChecks.filter(function(c) { return c.status === 'pass'; }).length;
      var issues = doctorChecks.filter(function(c) { return c.status === 'fail' || c.status === 'warn'; }).length;
      doctorUpdateRing(pass, doctorChecks.length, issues);
    }
  }
}

/**
 * @param {HTMLElement} container
 * @param {string} line
 * @param {'stdout'|'stderr'|'error'} type
 * @returns {void}
 */
function doctorAppendHealLine(container, line, type) {
  /** @type {Record<string, string>} */
  var colorMap = { stdout: '#a2c9ff', stderr: '#d29922', error: '#f85149' };
  var div = document.createElement('div');
  div.className = 'leading-5';
  div.style.color = colorMap[type] || '#a2c9ff';
  div.textContent = line;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/** @returns {void} */
function closeDoctorHealModal() {
  var modal = $id('doctor-heal-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  if (doctorHealAbortController) {
    doctorHealAbortController.abort();
    doctorHealAbortController = null;
  }
  doctorCurrentHealId = null;
}

/** @returns {void} */
function doctorRecheckFromModal() {
  if (!doctorCurrentHealId) return;
  var id = doctorCurrentHealId;
  closeDoctorHealModal();
  apiFetch('/api/doctor/recheck/' + encodeURIComponent(id), { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      /** @type {{check?: DoctorCheck}} */
      var result = /** @type {any} */ (data);
      if (result.check) {
        var idx = doctorChecks.findIndex(function(c) { return c.id === id; });
        if (idx !== -1) doctorChecks[idx] = result.check;
        renderDoctorChecks();
      }
    })
    .catch(function() { loadDoctorChecks(); });
}

/* ══════════════════════════════════════════════════════════════
   Level3: Manual Guide Panel
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string} id
 * @returns {void}
 */
function doctorOpenGuidePanel(id) {
  var check = doctorChecks.find(function(c) { return c.id === id; });
  if (!check) return;

  doctorCurrentHealId = id;

  var panel = $id('doctor-guide-panel');
  var titleEl = $id('doctor-guide-title');
  var contentEl = $id('doctor-guide-content');
  var docsSection = $id('doctor-guide-docs');
  var docsLink = $id('doctor-guide-docs-link');

  if (titleEl) titleEl.textContent = check.name + ' — 복구 가이드';
  if (contentEl) contentEl.textContent = check.guide || '수동으로 이 항목을 해결해주세요.';

  if (docsSection && docsLink) {
    if (check.docsUrl) {
      docsLink.setAttribute('href', check.docsUrl);
      docsSection.classList.remove('hidden');
    } else {
      docsSection.classList.add('hidden');
    }
  }

  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('flex');
  }
}

/** @returns {void} */
function closeDoctorGuidePanel() {
  var panel = $id('doctor-guide-panel');
  if (panel) {
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  }
  doctorCurrentHealId = null;
}

/** @returns {void} */
function doctorGuideDone() {
  if (!doctorCurrentHealId) { closeDoctorGuidePanel(); return; }
  var id = doctorCurrentHealId;
  closeDoctorGuidePanel();
  apiFetch('/api/doctor/recheck/' + encodeURIComponent(id), { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      /** @type {{check?: DoctorCheck}} */
      var result = /** @type {any} */ (data);
      if (result.check) {
        var idx = doctorChecks.findIndex(function(c) { return c.id === id; });
        if (idx !== -1) doctorChecks[idx] = result.check;
        renderDoctorChecks();
      }
    })
    .catch(function() { loadDoctorChecks(); });
}

/* ══════════════════════════════════════════════════════════════
   Auto-load via MutationObserver (no app.js modification needed)
   ══════════════════════════════════════════════════════════════ */

/** @returns {void} */
function initDoctorObserver() {
  var viewEl = $id('view-doctor');
  if (!viewEl) return;
  var el = viewEl;
  var obs = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        if (el.classList.contains('active') && doctorChecks.length === 0) {
          loadDoctorChecks();
        }
      }
    });
  });
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
}

document.addEventListener('DOMContentLoaded', function() {
  initDoctorObserver();
});

window.loadDoctorChecks      = loadDoctorChecks;
window.doctorRunAllLevel1    = doctorRunAllLevel1;
window.doctorHealLevel1      = doctorHealLevel1;
window.doctorOpenHealModal   = doctorOpenHealModal;
window.closeDoctorHealModal  = closeDoctorHealModal;
window.doctorRecheckFromModal = doctorRecheckFromModal;
window.doctorOpenGuidePanel  = doctorOpenGuidePanel;
window.closeDoctorGuidePanel = closeDoctorGuidePanel;
window.doctorGuideDone       = doctorGuideDone;
