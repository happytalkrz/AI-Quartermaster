// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Tutorial Overlay — Plan B B6
   ══════════════════════════════════════════════════════════════ */

var TUTORIAL_TOTAL_STEPS = 4;

/** @type {Record<string, string>} */
var TUTORIAL_ICONS = {
  '1': 'school',
  '2': 'monitoring',
  '3': 'merge',
  '4': 'celebration',
};

/** @returns {number} */
function getTutorialStep() {
  return parseInt(localStorage.getItem('aqm-tutorial-step') || '1', 10);
}

/** @param {number} step @returns {void} */
function setTutorialStep(step) {
  localStorage.setItem('aqm-tutorial-step', String(step));
}

/** @returns {boolean} */
function isTutorialViewed() {
  return localStorage.getItem('aqm-tutorial-viewed') === 'true';
}

/** @returns {void} */
function markTutorialViewed() {
  localStorage.setItem('aqm-tutorial-viewed', 'true');
}

/**
 * @param {number} step
 * @returns {{ title: string, desc: string }}
 */
function getTutorialContent(step) {
  var lang = typeof currentLang !== 'undefined' ? currentLang : 'ko';
  var tkeys = (typeof i18n !== 'undefined' && i18n[lang] && /** @type {any} */ (i18n[lang]).tutorial)
    ? /** @type {any} */ (i18n[lang]).tutorial
    : null;

  if (!tkeys) {
    // fallback strings
    var fallback = /** @type {Record<string, {title:string, desc:string}>} */ ({
      '1': { title: '이슈 만들기', desc: "사이드바의 '새 이슈' 메뉴에서 카테고리를 선택하고 이슈를 작성해 보세요. AQM이 자동으로 처리를 시작합니다." },
      '2': { title: '파이프라인 관찰', desc: '대시보드에서 이슈가 처리되는 과정을 실시간으로 확인할 수 있습니다. 각 단계의 진행률이 표시됩니다.' },
      '3': { title: 'PR 확인', desc: '처리가 완료되면 자동으로 Pull Request가 생성됩니다. 작업 상세에서 PR 링크를 확인하세요.' },
      '4': { title: '준비 완료!', desc: '이제 AQM 사용 준비가 끝났습니다. 직접 이슈를 만들어 보세요!' },
    });
    return fallback[String(step)] || { title: '', desc: '' };
  }

  var titles = {
    1: String(tkeys.step1Title || ''),
    2: String(tkeys.step2Title || ''),
    3: String(tkeys.step3Title || ''),
    4: String(tkeys.step4Title || ''),
  };
  var descs = {
    1: String(tkeys.step1Desc || ''),
    2: String(tkeys.step2Desc || ''),
    3: String(tkeys.step3Desc || ''),
    4: String(tkeys.step4Desc || ''),
  };
  return { title: titles[/** @type {1|2|3|4} */ (step)] || '', desc: descs[/** @type {1|2|3|4} */ (step)] || '' };
}

/** @returns {string} */
function renderStepDots() {
  var step = getTutorialStep();
  var dots = '';
  for (var i = 1; i <= TUTORIAL_TOTAL_STEPS; i++) {
    if (i <= step) {
      dots += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tw-tutorial-primary,#a2c9ff);margin:0 3px;"></span>';
    } else {
      dots += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;border:2px solid var(--tw-tutorial-outline,#8b919d);margin:0 3px;box-sizing:border-box;"></span>';
    }
  }
  return dots;
}

/** @returns {string} */
function getTutorialLangKey(/** @type {string} */ key) {
  var lang = typeof currentLang !== 'undefined' ? currentLang : 'ko';
  var tkeys = (typeof i18n !== 'undefined' && i18n[lang] && /** @type {any} */ (i18n[lang]).tutorial)
    ? /** @type {any} */ (i18n[lang]).tutorial
    : null;
  if (!tkeys) {
    var fallback = /** @type {Record<string,string>} */ ({ next: '다음', done: '시작하기', skip: '건너뛰기', createIssue: '이슈 만들기', stepOf: '/ ' });
    return fallback[key] || key;
  }
  return String(tkeys[key] || key);
}

/** @returns {void} */
function renderTutorialOverlay() {
  var container = document.getElementById('tutorial-overlay');
  if (!container) return;

  var step = getTutorialStep();
  var content = getTutorialContent(step);
  var icon = TUTORIAL_ICONS[String(step)] || 'school';
  var isLast = step === TUTORIAL_TOTAL_STEPS;
  var stepLabel = String(step) + ' ' + getTutorialLangKey('stepOf') + String(TUTORIAL_TOTAL_STEPS);
  var actionBtnLabel = isLast ? getTutorialLangKey('done') : getTutorialLangKey('next');
  var ctaHtml = isLast
    ? '<button onclick="dismissTutorial(); if(typeof navigateTo===\'function\')navigateTo(\'new-issue\');" class="tutorial-cta-btn" style="margin-top:6px;padding:8px 16px;font-size:12px;border:1px solid rgba(162,201,255,0.4);border-radius:8px;background:transparent;color:#a2c9ff;cursor:pointer;">' + getTutorialLangKey('createIssue') + '</button>'
    : '';

  container.innerHTML = ''
    + '<div id="tutorial-backdrop" onclick="dismissTutorial()" style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);"></div>'
    + '<div id="tutorial-card" style="position:fixed;z-index:1001;top:50%;left:50%;transform:translate(-50%,-50%);width:min(calc(100vw - 2rem),440px);background:#1c2026;border-radius:16px;box-shadow:0 24px 48px -12px rgba(0,0,0,0.6);ring:1px solid rgba(255,255,255,0.1);padding:32px 28px 24px;font-family:Inter,sans-serif;animation:tutorialFadeIn 0.25s ease-out;">'
    +   '<div style="display:flex;justify-content:flex-end;margin-bottom:4px;">'
    +     '<button onclick="dismissTutorial()" style="background:none;border:none;color:#8b919d;cursor:pointer;font-size:13px;padding:0;">' + getTutorialLangKey('skip') + '</button>'
    +   '</div>'
    +   '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;">'
    +     '<div style="width:64px;height:64px;border-radius:50%;background:rgba(162,201,255,0.1);display:flex;align-items:center;justify-content:center;ring:1px solid rgba(162,201,255,0.15);">'
    +       '<span class="material-symbols-outlined" style="font-size:32px;color:#a2c9ff;font-variation-settings:\'FILL\' 1;">' + icon + '</span>'
    +     '</div>'
    +     '<div>'
    +       '<div style="font-size:11px;color:#8b919d;margin-bottom:6px;">' + stepLabel + '</div>'
    +       '<h2 style="font-size:20px;font-weight:700;color:#dfe2eb;margin:0 0 10px;font-family:Space Grotesk,sans-serif;letter-spacing:-0.3px;">' + content.title + '</h2>'
    +       '<p style="font-size:14px;line-height:1.6;color:#8b919d;margin:0;">' + content.desc + '</p>'
    +     '</div>'
    +     '<div style="display:flex;gap:4px;margin-top:4px;">' + renderStepDots() + '</div>'
    +     '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;margin-top:8px;">'
    +       '<button onclick="advanceTutorialStep()" style="width:100%;padding:12px;font-size:15px;font-weight:600;border:none;border-radius:10px;background:#a2c9ff;color:#00315c;cursor:pointer;transition:filter 0.15s;" onmouseover="this.style.filter=\'brightness(1.1)\'" onmouseout="this.style.filter=\'\'"> ' + actionBtnLabel + '</button>'
    +       ctaHtml
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '<style>@keyframes tutorialFadeIn{from{opacity:0;transform:translate(-50%,-50%) scale(0.95)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}</style>';
}

/** @returns {void} */
function advanceTutorialStep() {
  var step = getTutorialStep();
  if (step >= TUTORIAL_TOTAL_STEPS) {
    dismissTutorial();
    return;
  }
  setTutorialStep(step + 1);
  renderTutorialOverlay();
}

/** @returns {void} */
function dismissTutorial() {
  markTutorialViewed();
  var container = document.getElementById('tutorial-overlay');
  if (container) container.innerHTML = '';
}

/** @returns {void} */
function initTutorial() {
  if (isTutorialViewed()) return;
  setTutorialStep(1);
  renderTutorialOverlay();
}

window.initTutorial = initTutorial;
window.advanceTutorialStep = advanceTutorialStep;
window.dismissTutorial = dismissTutorial;
window.renderTutorialOverlay = renderTutorialOverlay;
