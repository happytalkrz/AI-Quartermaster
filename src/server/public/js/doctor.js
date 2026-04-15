// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Doctor — System Health Check
   ══════════════════════════════════════════════════════════════ */

/**
 * @typedef {'pass' | 'fail' | 'warn'} CheckStatus
 * @typedef {'critical' | 'warning' | 'info'} CheckSeverity
 */

/**
 * @typedef {Object} DoctorCheck
 * @property {string} id
 * @property {string} label
 * @property {CheckSeverity} severity
 * @property {CheckStatus} status
 * @property {string} detail
 * @property {string[]} fixSteps
 * @property {string} [docsUrl]
 * @property {1 | 2 | 3} [healLevel]
 * @property {string} [autoFixCommand]
 */

/** SVG ring circumference for r=54: 2 * PI * 54 ≈ 339.292 */
var DOCTOR_CIRCUMFERENCE = 339.292;

/** @type {boolean} */
var doctorRunning = false;

/** @type {string | null} */
var doctorLastRunTime = null;

/** @type {DoctorCheck[]} */
var doctorLastChecks = [];

/** @type {EventSource | null} */
var doctorHealEs = null;

/**
 * @param {DoctorCheck[]} checks
 * @returns {number}  0–10
 */
function calcDoctorScore(checks) {
  if (checks.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < checks.length; i++) {
    if (checks[i].status === 'pass') sum += 1;
    else if (checks[i].status === 'warn') sum += 0.5;
  }
  return Math.round((sum / checks.length) * 10);
}

/**
 * @param {number} score
 * @returns {string}
 */
function doctorScoreColor(score) {
  if (score >= 8) return '#3fb950';
  if (score >= 5) return '#da9600';
  return '#f85149';
}

/**
 * @param {number} score
 * @returns {void}
 */
function updateDoctorRing(score) {
  var ring = /** @type {SVGCircleElement | null} */ (document.getElementById('doctor-ring-progress'));
  var scoreEl = document.getElementById('doctor-score-text');
  var color = doctorScoreColor(score);

  if (ring) {
    var offset = DOCTOR_CIRCUMFERENCE * (1 - score / 10);
    ring.style.strokeDashoffset = String(offset);
    ring.style.stroke = color;
  }
  if (scoreEl) {
    scoreEl.textContent = score + '/10';
    scoreEl.style.color = color;
  }
}

/**
 * @param {DoctorCheck} check
 * @returns {string}
 */
function renderDoctorCheckRow(check) {
  /** @type {Record<string, string>} */
  var iconMap = { pass: 'check_circle', warn: 'warning', fail: 'error' };
  /** @type {Record<string, string>} */
  var colorMap = { pass: '#3fb950', warn: '#da9600', fail: '#f85149' };

  var icon = iconMap[check.status] || 'help';
  var color = colorMap[check.status] || '#8b919d';

  var fixHtml = '';
  if (check.fixSteps && check.fixSteps.length > 0) {
    var items = check.fixSteps.map(function(s) {
      return '<li class="text-[11px] text-outline font-mono mt-1 pl-3 border-l-2 border-outline-variant/30 leading-relaxed">' + esc(s) + '</li>';
    }).join('');
    fixHtml = '<ul class="mt-2 space-y-0.5">' + items + '</ul>';
  }

  var docsHtml = check.docsUrl
    ? '<a href="' + esc(check.docsUrl) + '" target="_blank" rel="noopener noreferrer" class="text-[11px] text-primary hover:underline mt-1.5 inline-block">공식 문서 →</a>'
    : '';

  var healHtml = '';
  if (check.status !== 'pass' && check.healLevel) {
    var safeId = esc(check.id);
    if (check.healLevel === 1) {
      healHtml =
        '<button id="heal-btn-' + safeId + '" ' +
          'onclick="doctorHealLevel1(\'' + safeId + '\')" ' +
          'class="mt-2 flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">' +
          '<span class="material-symbols-outlined text-[14px]">auto_fix_high</span>' +
          '<span>자동 복구</span>' +
        '</button>';
    } else if (check.healLevel === 2) {
      healHtml =
        '<button id="heal-btn-' + safeId + '" ' +
          'onclick="doctorHealLevel2(\'' + safeId + '\')" ' +
          'class="mt-2 flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md text-[#da9600] hover:opacity-80 transition-colors" ' +
          'style="background-color:#da960020;">' +
          '<span class="material-symbols-outlined text-[14px]">terminal</span>' +
          '<span>대화형 복구</span>' +
        '</button>';
    } else if (check.healLevel === 3) {
      healHtml =
        '<button id="heal-btn-' + safeId + '" ' +
          'onclick="doctorHealLevel3(\'' + safeId + '\')" ' +
          'class="mt-2 flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md text-outline hover:text-on-surface transition-colors" ' +
          'style="background-color:#ffffff10;">' +
          '<span class="material-symbols-outlined text-[14px]">menu_book</span>' +
          '<span>가이드 보기</span>' +
        '</button>';
    }
  }

  return (
    '<div class="flex items-start gap-4 p-4 bg-surface-container rounded-xl ring-1 ring-outline-variant/10">' +
      '<span class="material-symbols-outlined text-2xl mt-0.5 shrink-0" style="color:' + color + '; font-variation-settings: \'FILL\' 1;">' + icon + '</span>' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="text-sm font-bold text-on-surface">' + esc(check.label) + '</span>' +
          '<span class="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold" style="color:' + color + '; background-color:' + color + '22;">' + esc(check.status) + '</span>' +
        '</div>' +
        '<p class="text-xs text-outline mt-1">' + esc(check.detail) + '</p>' +
        fixHtml +
        docsHtml +
        healHtml +
      '</div>' +
    '</div>'
  );
}

/**
 * @param {DoctorCheck[]} checks
 * @returns {void}
 */
function renderDoctorResults(checks) {
  doctorLastChecks = checks;
  var container = document.getElementById('doctor-checks-container');
  var lastRunEl = document.getElementById('doctor-last-run');

  if (lastRunEl && doctorLastRunTime) {
    var d = new Date(doctorLastRunTime);
    lastRunEl.textContent = '마지막 검사: ' + d.toLocaleString('ko-KR');
  }

  updateDoctorRing(calcDoctorScore(checks));

  if (!container) return;

  if (checks.length === 0) {
    container.innerHTML = '<div class="flex items-center justify-center py-12 text-outline text-sm">결과 없음</div>';
    return;
  }

  container.innerHTML = checks.map(renderDoctorCheckRow).join('');
}

/** @returns {void} */
function restoreDoctorBtn() {
  var btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('doctor-run-btn'));
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm">refresh</span><span>다시 검사</span>';
}

/** @returns {void} */
function runDoctorCheck() {
  if (doctorRunning) return;
  doctorRunning = true;

  var btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('doctor-run-btn'));
  var container = document.getElementById('doctor-checks-container');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>검사 중...</span>';
  }
  if (container) {
    container.innerHTML =
      '<div class="flex items-center justify-center py-12 text-outline text-sm gap-2">' +
        '<span class="material-symbols-outlined animate-spin">sync</span>' +
        '검사 실행 중...' +
      '</div>';
  }

  apiFetch('/api/doctor/run')
    .then(function(r) { return r.json(); })
    .then(function(/** @type {{checks: DoctorCheck[]}} */ data) {
      doctorLastRunTime = new Date().toISOString();
      renderDoctorResults(data.checks || []);
      doctorRunning = false;
      restoreDoctorBtn();
    })
    .catch(function() {
      updateDoctorRing(0);
      if (container) {
        container.innerHTML =
          '<div class="flex items-center justify-center py-12 text-outline text-sm gap-2">' +
            '<span class="material-symbols-outlined">error</span>' +
            '검사 실행에 실패했습니다.' +
          '</div>';
      }
      doctorRunning = false;
      restoreDoctorBtn();
    });
}

/* ══════════════════════════════════════════════════════════════
   Level 1 — Auto Heal (1-click, no interaction)
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {string} checkId
 * @returns {void}
 */
function doctorHealLevel1(checkId) {
  var btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('heal-btn-' + checkId));
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML =
    '<span class="material-symbols-outlined text-[14px] animate-spin">sync</span>' +
    '<span>복구 중...</span>';

  apiFetch('/api/doctor/heal/' + encodeURIComponent(checkId), { method: 'POST' })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(b) { return Promise.reject(b); });
      return r.json();
    })
    .then(function() {
      if (btn) {
        btn.innerHTML =
          '<span class="material-symbols-outlined text-[14px]">check_circle</span>' +
          '<span>복구 완료</span>';
        btn.style.cssText = 'background-color:#3fb95020;color:#3fb950;';
      }
      setTimeout(runDoctorCheck, 1500);
    })
    .catch(function(/** @type {unknown} */ err) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML =
          '<span class="material-symbols-outlined text-[14px]">error</span>' +
          '<span>복구 실패 — 재시도</span>';
      }
      var msg = '자동 복구에 실패했습니다.';
      if (err && typeof err === 'object' && 'error' in err && typeof (/** @type {{error:unknown}} */ (err)).error === 'string') {
        msg = /** @type {{error:string}} */ (err).error;
      }
      showToast(msg, 'error');
    });
}

/* ══════════════════════════════════════════════════════════════
   Level 2 — Interactive Heal (SSE streaming modal)
   ══════════════════════════════════════════════════════════════ */

/** @returns {void} */
function ensureDoctorHealL2Modal() {
  if (document.getElementById('doctor-heal-l2-modal')) return;
  var el = document.createElement('div');
  el.id = 'doctor-heal-l2-modal';
  el.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/60 backdrop-blur-sm';
  el.innerHTML =
    '<div class="bg-surface-container w-full max-w-2xl mx-4 rounded-2xl shadow-2xl flex flex-col" style="max-height:80vh;">' +
      '<div class="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">' +
        '<div class="flex items-center gap-2">' +
          '<span class="material-symbols-outlined text-[18px] text-primary">terminal</span>' +
          '<span id="doctor-heal-l2-title" class="text-sm font-bold text-on-surface">대화형 복구</span>' +
        '</div>' +
        '<button onclick="closeDoctorHealL2Modal()" class="text-outline hover:text-on-surface transition-colors">' +
          '<span class="material-symbols-outlined text-[20px]">close</span>' +
        '</button>' +
      '</div>' +
      '<div id="doctor-heal-l2-output" ' +
        'class="flex-1 overflow-y-auto p-4 font-mono text-xs bg-[#0d1117] text-[#c9d1d9]" ' +
        'style="min-height:200px;white-space:pre-wrap;word-break:break-all;">' +
      '</div>' +
      '<div id="doctor-heal-l2-stdin-row" class="flex gap-2 px-4 py-3 border-t border-outline-variant/20">' +
        '<input id="doctor-heal-l2-input" type="text" placeholder="입력 후 Enter 또는 Send..." ' +
          'onkeydown="if(event.key===\'Enter\')doctorHealL2Send();" ' +
          'class="flex-1 bg-surface text-on-surface text-xs px-3 py-2 rounded-lg ring-1 ring-outline-variant/30 focus:outline-none" />' +
        '<button onclick="doctorHealL2Send()" ' +
          'class="px-3 py-2 text-xs font-bold bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors">' +
          'Send' +
        '</button>' +
      '</div>' +
      '<div class="flex items-center justify-between px-5 py-3 border-t border-outline-variant/20">' +
        '<span id="doctor-heal-l2-status" class="text-[11px] text-outline">연결 중...</span>' +
        '<div class="flex gap-2">' +
          '<button onclick="closeDoctorHealL2Modal()" ' +
            'class="px-3 py-1.5 text-xs font-bold text-outline hover:text-on-surface rounded-lg transition-colors">' +
            '닫기' +
          '</button>' +
          '<button id="doctor-heal-l2-recheck" onclick="doctorHealL2Recheck()" disabled ' +
            'class="px-3 py-1.5 text-xs font-bold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">' +
            '재검사' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

/** @returns {void} */
function closeDoctorHealL2Modal() {
  var modal = document.getElementById('doctor-heal-l2-modal');
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
  if (doctorHealEs) {
    doctorHealEs.close();
    doctorHealEs = null;
  }
}

/** @returns {void} */
function doctorHealL2Send() {
  var input = /** @type {HTMLInputElement | null} */ (document.getElementById('doctor-heal-l2-input'));
  if (!input || !input.value.trim()) return;
  var value = input.value.trim();
  input.value = '';

  var outputEl = document.getElementById('doctor-heal-l2-output');
  if (outputEl) {
    outputEl.innerHTML += '<span style="color:#58a6ff">&gt; ' + esc(value) + '</span>\n';
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  apiFetch('/api/doctor/heal/stdin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: value }),
  }).catch(function() {});
}

/** @returns {void} */
function doctorHealL2Recheck() {
  closeDoctorHealL2Modal();
  runDoctorCheck();
}

/**
 * @param {string} checkId
 * @returns {void}
 */
function doctorHealLevel2(checkId) {
  ensureDoctorHealL2Modal();

  var modal = document.getElementById('doctor-heal-l2-modal');
  var titleEl = document.getElementById('doctor-heal-l2-title');
  var outputEl = document.getElementById('doctor-heal-l2-output');
  var statusEl = document.getElementById('doctor-heal-l2-status');
  var recheckBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('doctor-heal-l2-recheck'));
  var stdinRow = document.getElementById('doctor-heal-l2-stdin-row');

  var check = doctorLastChecks.find(function(c) { return c.id === checkId; });
  var label = check ? check.label : checkId;

  if (titleEl) titleEl.textContent = label + ' — 대화형 복구';
  if (outputEl) outputEl.innerHTML = '';
  if (statusEl) statusEl.textContent = '연결 중...';
  if (recheckBtn) recheckBtn.disabled = true;
  if (stdinRow) stdinRow.style.display = 'flex';

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  if (doctorHealEs) { doctorHealEs.close(); doctorHealEs = null; }

  var key = getApiKey();
  var sseUrl = '/api/doctor/heal/' + encodeURIComponent(checkId) + '/stream' +
    (key ? '?key=' + encodeURIComponent(key) : '');

  doctorHealEs = new EventSource(sseUrl);

  doctorHealEs.onopen = function() {
    if (statusEl) statusEl.textContent = '실행 중...';
  };

  doctorHealEs.onmessage = function(e) {
    if (outputEl) {
      outputEl.innerHTML += esc(e.data) + '\n';
      outputEl.scrollTop = outputEl.scrollHeight;
    }
  };

  doctorHealEs.addEventListener('done', function() {
    if (outputEl) {
      outputEl.innerHTML += '<span style="color:#3fb950">✓ 완료</span>\n';
      outputEl.scrollTop = outputEl.scrollHeight;
    }
    if (statusEl) statusEl.textContent = '완료';
    if (recheckBtn) recheckBtn.disabled = false;
    if (stdinRow) stdinRow.style.display = 'none';
    if (doctorHealEs) { doctorHealEs.close(); doctorHealEs = null; }
  });

  doctorHealEs.addEventListener('fail', function(e) {
    var msg = /** @type {MessageEvent} */ (e).data || '';
    if (outputEl) {
      outputEl.innerHTML += '<span style="color:#f85149">✗ 오류: ' + esc(String(msg)) + '</span>\n';
      outputEl.scrollTop = outputEl.scrollHeight;
    }
    if (statusEl) statusEl.textContent = '오류 발생';
    if (recheckBtn) recheckBtn.disabled = false;
    if (stdinRow) stdinRow.style.display = 'none';
    if (doctorHealEs) { doctorHealEs.close(); doctorHealEs = null; }
  });

  doctorHealEs.onerror = function() {
    if (statusEl && statusEl.textContent === '연결 중...') {
      statusEl.textContent = '연결 실패';
    }
    if (recheckBtn) recheckBtn.disabled = false;
    if (stdinRow) stdinRow.style.display = 'none';
    if (doctorHealEs) { doctorHealEs.close(); doctorHealEs = null; }
  };
}

/* ══════════════════════════════════════════════════════════════
   Level 3 — Manual Guide Modal
   ══════════════════════════════════════════════════════════════ */

/** @returns {void} */
function ensureDoctorHealL3Modal() {
  if (document.getElementById('doctor-heal-l3-modal')) return;
  var el = document.createElement('div');
  el.id = 'doctor-heal-l3-modal';
  el.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/60 backdrop-blur-sm';
  el.innerHTML =
    '<div class="bg-surface-container w-full max-w-lg mx-4 rounded-2xl shadow-2xl flex flex-col" style="max-height:80vh;">' +
      '<div class="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">' +
        '<div class="flex items-center gap-2">' +
          '<span class="material-symbols-outlined text-[18px] text-outline">menu_book</span>' +
          '<span id="doctor-heal-l3-title" class="text-sm font-bold text-on-surface">수동 복구 가이드</span>' +
        '</div>' +
        '<button onclick="closeDoctorHealL3Modal()" class="text-outline hover:text-on-surface transition-colors">' +
          '<span class="material-symbols-outlined text-[20px]">close</span>' +
        '</button>' +
      '</div>' +
      '<div id="doctor-heal-l3-steps" class="flex-1 overflow-y-auto px-5 py-4 space-y-3"></div>' +
      '<div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-outline-variant/20">' +
        '<button onclick="closeDoctorHealL3Modal()" ' +
          'class="px-3 py-1.5 text-xs font-bold text-outline hover:text-on-surface rounded-lg transition-colors">' +
          '닫기' +
        '</button>' +
        '<button onclick="doctorHealL3Done()" ' +
          'class="px-4 py-1.5 text-xs font-bold bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-all active:scale-95">' +
          '완료했어요 — 재검사' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

/** @returns {void} */
function closeDoctorHealL3Modal() {
  var modal = document.getElementById('doctor-heal-l3-modal');
  if (modal) {
    modal.classList.remove('flex');
    modal.classList.add('hidden');
  }
}

/** @returns {void} */
function doctorHealL3Done() {
  closeDoctorHealL3Modal();
  runDoctorCheck();
}

/**
 * @param {string} checkId
 * @returns {void}
 */
function doctorHealLevel3(checkId) {
  ensureDoctorHealL3Modal();

  var check = doctorLastChecks.find(function(c) { return c.id === checkId; });
  var titleEl = document.getElementById('doctor-heal-l3-title');
  var stepsEl = document.getElementById('doctor-heal-l3-steps');

  if (titleEl) titleEl.textContent = (check ? check.label : checkId) + ' — 수동 복구 가이드';

  if (stepsEl) {
    var steps = (check && check.fixSteps && check.fixSteps.length > 0)
      ? check.fixSteps
      : ['설치 공식 문서를 참조하세요.'];

    stepsEl.innerHTML = steps.map(function(s, i) {
      return (
        '<div class="flex gap-3 items-start">' +
          '<span class="text-[11px] font-bold text-primary rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5" style="background-color:#58a6ff22;color:#58a6ff;">' + (i + 1) + '</span>' +
          '<span class="text-xs text-on-surface font-mono leading-relaxed">' + esc(s) + '</span>' +
        '</div>'
      );
    }).join('');

    if (check && check.docsUrl) {
      stepsEl.innerHTML +=
        '<div class="pt-3 border-t border-outline-variant/20">' +
          '<a href="' + esc(check.docsUrl) + '" target="_blank" rel="noopener noreferrer" ' +
            'class="text-[11px] text-primary hover:underline flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px]">open_in_new</span>' +
            '공식 문서 보기' +
          '</a>' +
        '</div>';
    }
  }

  var modal = document.getElementById('doctor-heal-l3-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

// Auto-run when the page loads
document.addEventListener('DOMContentLoaded', function() {
  ensureDoctorHealL2Modal();
  ensureDoctorHealL3Modal();
  runDoctorCheck();
});
