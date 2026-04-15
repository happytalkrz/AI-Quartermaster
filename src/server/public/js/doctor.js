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
 */

/** SVG ring circumference for r=54: 2 * PI * 54 ≈ 339.292 */
var DOCTOR_CIRCUMFERENCE = 339.292;

/** @type {boolean} */
var doctorRunning = false;

/** @type {string | null} */
var doctorLastRunTime = null;

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
      '</div>' +
    '</div>'
  );
}

/**
 * @param {DoctorCheck[]} checks
 * @returns {void}
 */
function renderDoctorResults(checks) {
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

// Auto-run when the page loads
document.addEventListener('DOMContentLoaded', function() {
  runDoctorCheck();
});
