// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Setup Wizard — Step 1~5
   ══════════════════════════════════════════════════════════════ */

/** @type {number} */
var _setupCurrentStep = 1;

/**
 * @type {{
 *   githubToken?: string,
 *   username?: string,
 *   repo?: string,
 *   repoPath?: string,
 *   baseBranch?: string,
 *   mode?: string,
 *   instanceOwners?: string[],
 *   allowedLabels?: string[]
 * }}
 */
var _setupWizardData = {};

/** @type {ReturnType<typeof setTimeout> | null} */
var _setupDebounceTimer = null;

/** @type {boolean} */
var _setupListenerAttached = false;

// Step 1 validate function — overrides the inline script definition
// (setup.js loads after inline scripts, so this assignment wins)
/** @type {() => void} */
var validateGitHubToken = function () {
  var tokenInputEl = document.getElementById('setup-github-token');
  var btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('setup-validate-btn'));
  var resultEl = document.getElementById('setup-validate-result');
  var contentEl = document.getElementById('setup-validate-content');
  var nextBtn = document.getElementById('setup-step1-next');

  if (!tokenInputEl || !btn || !resultEl || !contentEl) return;
  var tokenInput = /** @type {HTMLInputElement} */ (tokenInputEl);
  var token = tokenInput.value.trim();
  // safe references after null-guard above
  var safeResult = /** @type {HTMLElement} */ (resultEl);
  var safeContent = /** @type {HTMLElement} */ (contentEl);
  var safeBtn = /** @type {HTMLButtonElement} */ (btn);

  if (!token) {
    safeResult.className = 'mt-6 p-4 rounded-xl bg-surface-container-low ring-1 ring-outline-variant/20';
    safeContent.innerHTML =
      '<span class="material-symbols-outlined text-outline text-base mt-0.5">info</span>' +
      '<span class="text-outline ml-2">토큰을 입력하세요.</span>';
    safeResult.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
    return;
  }

  safeBtn.disabled = true;
  safeResult.className = 'mt-6 p-4 rounded-xl bg-surface-container-low ring-1 ring-outline-variant/20';
  safeContent.innerHTML =
    '<span class="material-symbols-outlined text-primary text-base mt-0.5 animate-spin">progress_activity</span>' +
    '<span class="text-outline ml-2">검증 중...</span>';
  safeResult.classList.remove('hidden');

  fetch('/api/setup/validate-token', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (resp) {
      return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
    })
    .then(function (result) {
      if (result.ok && result.data.username) {
        _setupWizardData.githubToken = token;
        _setupWizardData.username = result.data.username;
        safeResult.className = 'mt-6 p-4 rounded-xl bg-[#238636]/10 ring-1 ring-[#238636]/30';
        safeContent.innerHTML =
          '<span class="material-symbols-outlined text-[#3fb950] text-base mt-0.5" style="font-variation-settings: \'FILL\' 1;">check_circle</span>' +
          '<div class="ml-2"><div class="font-bold text-on-surface">연결 성공</div>' +
          '<div class="text-xs text-outline mt-0.5">@' + _setupEscapeHtml(result.data.username) + '</div></div>';
        if (nextBtn) nextBtn.classList.remove('hidden');
      } else {
        var msg = (result.data && result.data.error) ? result.data.error : '토큰 검증에 실패했습니다.';
        safeResult.className = 'mt-6 p-4 rounded-xl bg-[#f85149]/10 ring-1 ring-[#f85149]/30';
        safeContent.innerHTML =
          '<span class="material-symbols-outlined text-[#f85149] text-base mt-0.5" style="font-variation-settings: \'FILL\' 1;">cancel</span>' +
          '<div class="ml-2"><div class="font-bold text-on-surface">검증 실패</div>' +
          '<div class="text-xs text-outline mt-0.5">' + _setupEscapeHtml(msg) + '</div></div>';
        if (nextBtn) nextBtn.classList.add('hidden');
      }
    })
    .catch(function () {
      safeResult.className = 'mt-6 p-4 rounded-xl bg-[#f85149]/10 ring-1 ring-[#f85149]/30';
      safeContent.innerHTML =
        '<span class="material-symbols-outlined text-[#f85149] text-base mt-0.5" style="font-variation-settings: \'FILL\' 1;">error</span>' +
        '<div class="ml-2"><div class="font-bold text-on-surface">요청 오류</div>' +
        '<div class="text-xs text-outline mt-0.5">서버에 연결할 수 없습니다.</div></div>';
      if (nextBtn) nextBtn.classList.add('hidden');
    })
    .finally(function () {
      safeBtn.disabled = false;
    });
};

/* ──────────────────────────────────────────────────────────────
   Step Navigation
   ────────────────────────────────────────────────────────────── */

/** @param {number} step @returns {void} */
function setupGoToStep(step) {
  _setupCurrentStep = step;

  for (var i = 1; i <= 5; i++) {
    var el = document.getElementById('setup-step-' + i);
    if (el) el.classList.toggle('hidden', i !== step);
  }

  // Update stepper circles — find via nth shrink-0 flex-col item inside stepper row
  var stepperRow = document.querySelector('#view-setup .flex.items-center.mb-10');
  if (stepperRow) {
    var items = stepperRow.querySelectorAll('.flex.flex-col.items-center.gap-1\\.5.shrink-0');
    items.forEach(function (item, idx) {
      var n = idx + 1;
      var circle = item.querySelector('div');
      var label = item.querySelector('span');
      if (!circle) return;
      if (n < step) {
        circle.className = 'w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary border border-primary/40';
        circle.innerHTML = '<span class="material-symbols-outlined text-sm" style="font-variation-settings: \'FILL\' 1; font-size:18px;">check</span>';
        if (label) label.className = 'text-[10px] font-bold text-primary/60 uppercase tracking-widest whitespace-nowrap';
      } else if (n === step) {
        circle.className = 'w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center font-bold text-sm text-on-primary shadow-lg shadow-primary/30';
        circle.textContent = String(n);
        if (label) label.className = 'text-[10px] font-bold text-primary uppercase tracking-widest whitespace-nowrap';
      } else {
        circle.className = 'w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center font-bold text-sm text-outline/50';
        circle.textContent = String(n);
        if (label) label.className = 'text-[10px] text-outline/40 uppercase tracking-widest whitespace-nowrap';
      }
    });
  }

  if (step === 2) setupLoadRepos();
  if (step === 3) setupRunLabelCreation();
  if (step === 4) {
    if (!_setupWizardData.instanceOwners) {
      _setupWizardData.instanceOwners = _setupWizardData.username ? [_setupWizardData.username] : [];
    }
    if (!_setupWizardData.allowedLabels) {
      _setupWizardData.allowedLabels = ['aqm-by'];
    }
    _setupRenderChips('setup-chips-owners');
    _setupRenderChips('setup-chips-labels');
  }
}

/* ──────────────────────────────────────────────────────────────
   Step 2: Repository Selection
   ────────────────────────────────────────────────────────────── */

/** @returns {boolean} */
function setupStep2Next() {
  var repoSelectEl = document.getElementById('setup-repo');
  var pathInputEl = document.getElementById('setup-repo-path');
  var errorEl = document.getElementById('setup-step2-error');

  if (!repoSelectEl || !pathInputEl) return false;
  var repoSelect = /** @type {HTMLSelectElement} */ (repoSelectEl);
  var pathInput = /** @type {HTMLInputElement} */ (pathInputEl);

  var repo = repoSelect.value.trim();
  var repoPath = pathInput.value.trim();

  if (!repo || !repo.includes('/')) {
    if (errorEl) { errorEl.textContent = '저장소를 선택하세요.'; errorEl.classList.remove('hidden'); }
    return false;
  }
  if (!repoPath) {
    if (errorEl) { errorEl.textContent = '로컬 경로를 입력하세요.'; errorEl.classList.remove('hidden'); }
    return false;
  }

  _setupWizardData.repo = repo;
  _setupWizardData.repoPath = repoPath;
  if (errorEl) errorEl.classList.add('hidden');
  setupGoToStep(3);
  return true;
}

/* ──────────────────────────────────────────────────────────────
   Step 3: Claude CLI
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function setupStep3Next() {
  setupGoToStep(4);
}

/* ──────────────────────────────────────────────────────────────
   Step 4: Notifications (minimal — proceed only)
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function setupStep4Next() {
  setupGoToStep(5);
  setupLoadPreview();
}

/* ──────────────────────────────────────────────────────────────
   Step 5: YAML Diff Preview + Apply
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function setupLoadPreview() {
  var previewEl = document.getElementById('setup-yaml-preview');
  var applyBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('setup-apply-btn'));
  if (!previewEl) return;
  var safePreview = /** @type {HTMLElement} */ (previewEl);

  safePreview.innerHTML =
    '<div class="text-outline text-xs flex items-center gap-2">' +
    '<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>' +
    '미리보기 생성 중...</div>';
  if (applyBtn) applyBtn.disabled = true;

  fetch('/api/setup/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: _setupWizardData.repo || '',
      repoPath: _setupWizardData.repoPath || '',
      baseBranch: _setupWizardData.baseBranch,
      mode: _setupWizardData.mode,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) {
        safePreview.innerHTML = '<div class="text-[#f85149] text-xs">' + _setupEscapeHtml(data.error) + '</div>';
        return;
      }
      safePreview.innerHTML = _setupRenderYamlDiff(data.diff, data.existingYaml);
      if (applyBtn) applyBtn.disabled = false;
    })
    .catch(function () {
      safePreview.innerHTML = '<div class="text-[#f85149] text-xs">미리보기를 불러올 수 없습니다.</div>';
    });
}

/**
 * @param {{ added: string[], removed: string[], unchanged: string[] }} diff
 * @param {string|null} existingYaml
 * @returns {string}
 */
function _setupRenderYamlDiff(diff, existingYaml) {
  /** @type {string[]} */
  var lines = [];

  if (existingYaml === null) {
    diff.added.forEach(function (l) {
      lines.push(
        '<div class="text-[#3fb950] flex gap-1.5"><span class="select-none opacity-60">+</span>' +
        '<span>' + _setupEscapeHtml(l) + '</span></div>'
      );
    });
  } else {
    diff.removed.forEach(function (l) {
      lines.push(
        '<div class="text-[#f85149] flex gap-1.5"><span class="select-none opacity-60">-</span>' +
        '<span>' + _setupEscapeHtml(l) + '</span></div>'
      );
    });
    diff.unchanged.forEach(function (l) {
      lines.push(
        '<div class="text-on-surface-variant/50 flex gap-1.5"><span class="select-none opacity-40"> </span>' +
        '<span>' + _setupEscapeHtml(l) + '</span></div>'
      );
    });
    diff.added.forEach(function (l) {
      lines.push(
        '<div class="text-[#3fb950] flex gap-1.5"><span class="select-none opacity-60">+</span>' +
        '<span>' + _setupEscapeHtml(l) + '</span></div>'
      );
    });
  }

  return '<div class="font-mono text-[11px] leading-relaxed space-y-0.5">' + lines.join('') + '</div>';
}

/** @returns {void} */
function setupApplyConfig() {
  var applyBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('setup-apply-btn'));
  var statusEl = document.getElementById('setup-apply-status');

  if (applyBtn) applyBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = '저장 중...';
    statusEl.classList.remove('hidden');
    statusEl.className = 'mt-4 text-xs text-outline text-center';
  }

  fetch('/api/setup/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: _setupWizardData.repo || '',
      repoPath: _setupWizardData.repoPath || '',
      baseBranch: _setupWizardData.baseBranch,
      mode: _setupWizardData.mode,
      token: _setupWizardData.githubToken,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        if (statusEl) {
          statusEl.className = 'mt-4 text-xs text-[#3fb950] text-center';
          statusEl.textContent = '저장 완료! 대시보드로 이동합니다...';
        }
        setTimeout(function () { window.location.href = '/'; }, 1500);
      } else {
        var msg = data.error || '저장에 실패했습니다.';
        if (statusEl) {
          statusEl.className = 'mt-4 text-xs text-[#f85149] text-center';
          statusEl.textContent = msg;
        }
        if (applyBtn) applyBtn.disabled = false;
      }
    })
    .catch(function () {
      if (statusEl) {
        statusEl.className = 'mt-4 text-xs text-[#f85149] text-center';
        statusEl.textContent = '서버 오류가 발생했습니다.';
      }
      if (applyBtn) applyBtn.disabled = false;
    });
}

/* ──────────────────────────────────────────────────────────────
   Dynamic HTML injection — Steps 2~5
   (setup.html is frozen to Step 1; we inject the rest via JS)
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function _setupInjectSteps() {
  var step1El = document.getElementById('setup-step-1');
  if (!step1El) return;
  var container = step1El.parentElement;
  if (!container) return;

  // Append "next" button to Step 1 (hidden until validation succeeds)
  if (!document.getElementById('setup-step1-next')) {
    var nextRow = document.createElement('div');
    nextRow.className = 'mt-6 flex justify-end';
    nextRow.innerHTML =
      '<button id="setup-step1-next" onclick="setupGoToStep(2)" ' +
      'class="hidden flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container ' +
      'text-on-primary font-bold text-sm rounded-lg transition-transform active:scale-95">' +
      '<span>다음 단계로</span>' +
      '<span class="material-symbols-outlined text-base">arrow_forward</span>' +
      '</button>';
    step1El.appendChild(nextRow);
  }

  // ── Step 2: Repository ──────────────────────────────────────
  if (!document.getElementById('setup-step-2')) {
    var step2 = document.createElement('div');
    step2.id = 'setup-step-2';
    step2.className = 'hidden bg-surface-container p-8 rounded-xl ring-1 ring-outline-variant/10';
    step2.innerHTML =
      '<div class="flex items-center gap-3 mb-6">' +
        '<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">' +
          '<span class="material-symbols-outlined text-primary">folder_open</span>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-headline text-lg font-bold text-on-surface">저장소 선택</h3>' +
          '<p class="text-xs text-outline mt-0.5">연동할 GitHub 저장소와 로컬 경로를 지정하세요</p>' +
        '</div>' +
      '</div>' +
      '<div class="space-y-4">' +
        '<div class="block">' +
          '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-1">GitHub 저장소</span>' +
          '<div id="setup-repo-loading" class="flex items-center gap-2 py-3 px-4 text-sm text-outline">' +
            '<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>' +
            '<span>저장소 불러오는 중...</span>' +
          '</div>' +
          '<select id="setup-repo" ' +
          'class="aqm-select hidden w-full bg-surface-container-lowest border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none">' +
            '<option value="">저장소 선택...</option>' +
          '</select>' +
        '</div>' +
        '<label class="block">' +
          '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-1">로컬 클론 경로</span>' +
          '<input type="text" id="setup-repo-path" ' +
          'class="w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface placeholder:text-outline/50 focus:border-primary transition-colors rounded-t outline-none font-mono" ' +
          'placeholder="/path/to/local/clone" autocomplete="off" spellcheck="false" />' +
        '</label>' +
        '<div id="setup-step2-error" class="hidden text-xs text-[#f85149] mt-1"></div>' +
      '</div>' +
      '<div class="flex justify-between mt-8 pt-6 border-t border-outline-variant/10">' +
        '<button onclick="setupGoToStep(1)" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-surface-container-high text-on-surface-variant font-bold text-sm rounded-lg hover:bg-surface-bright transition-all">' +
          '<span class="material-symbols-outlined text-base">arrow_back</span><span>이전</span>' +
        '</button>' +
        '<button onclick="setupStep2Next()" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-sm rounded-lg transition-transform active:scale-95">' +
          '<span>다음 단계로</span><span class="material-symbols-outlined text-base">arrow_forward</span>' +
        '</button>' +
      '</div>';
    container.appendChild(step2);
  }

  // ── Step 3: Label Auto-Creation ─────────────────────────────
  if (!document.getElementById('setup-step-3')) {
    var step3 = document.createElement('div');
    step3.id = 'setup-step-3';
    step3.className = 'hidden bg-surface-container p-8 rounded-xl ring-1 ring-outline-variant/10';
    step3.innerHTML =
      '<div class="flex items-center gap-3 mb-6">' +
        '<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">' +
          '<span class="material-symbols-outlined text-primary">label</span>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-headline text-lg font-bold text-on-surface">라벨 자동 생성</h3>' +
          '<p class="text-xs text-outline mt-0.5">AQM에서 사용할 GitHub 라벨을 저장소에 자동으로 생성합니다</p>' +
        '</div>' +
      '</div>' +
      '<div class="bg-surface-container-low rounded-xl ring-1 ring-outline-variant/10 divide-y divide-outline-variant/10 px-4">' +
        '<div id="setup-labels-list" class="py-3">' +
          '<div class="text-outline text-xs flex items-center gap-2">' +
            '<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>' +
            '<span>확인 중...</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="flex justify-between mt-8 pt-6 border-t border-outline-variant/10">' +
        '<button onclick="setupGoToStep(2)" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-surface-container-high text-on-surface-variant font-bold text-sm rounded-lg hover:bg-surface-bright transition-all">' +
          '<span class="material-symbols-outlined text-base">arrow_back</span><span>이전</span>' +
        '</button>' +
        '<button id="setup-step3-next-btn" onclick="setupStep3Next()" disabled ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-sm rounded-lg transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">' +
          '<span>다음 단계로</span><span class="material-symbols-outlined text-base">arrow_forward</span>' +
        '</button>' +
      '</div>';
    container.appendChild(step3);
  }

  // ── Step 4: Instance Owners & Allowed Labels ────────────────
  if (!document.getElementById('setup-step-4')) {
    var step4 = document.createElement('div');
    step4.id = 'setup-step-4';
    step4.className = 'hidden bg-surface-container p-8 rounded-xl ring-1 ring-outline-variant/10';
    step4.innerHTML =
      '<div class="flex items-center gap-3 mb-6">' +
        '<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">' +
          '<span class="material-symbols-outlined text-primary">manage_accounts</span>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-headline text-lg font-bold text-on-surface">소유자 / 권한 설정</h3>' +
          '<p class="text-xs text-outline mt-0.5">AQM을 사용할 수 있는 계정과 트리거 라벨을 설정하세요</p>' +
        '</div>' +
      '</div>' +
      '<div class="space-y-6">' +
        '<div>' +
          '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-2">인스턴스 소유자 (instanceOwners)</span>' +
          '<div id="setup-chips-owners" class="flex flex-wrap gap-2 mb-2 min-h-[28px]"></div>' +
          '<div class="flex gap-2">' +
            '<input type="text" id="setup-chip-owner-input" ' +
            'class="flex-1 bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-2 px-3 text-sm text-on-surface placeholder:text-outline/50 focus:border-primary transition-colors rounded-t outline-none font-mono" ' +
            'placeholder="GitHub 사용자명 입력 후 Enter" autocomplete="off" spellcheck="false" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_setupChipInputKeydown(\'setup-chip-owner-input\',\'setup-chips-owners\');}" />' +
            '<button type="button" onclick="_setupChipInputKeydown(\'setup-chip-owner-input\',\'setup-chips-owners\')" ' +
            'class="px-3 py-2 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors">' +
              '<span class="material-symbols-outlined text-sm">add</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-2">허용 라벨 (allowedLabels)</span>' +
          '<div id="setup-chips-labels" class="flex flex-wrap gap-2 mb-2 min-h-[28px]"></div>' +
          '<div class="flex gap-2">' +
            '<input type="text" id="setup-chip-label-input" ' +
            'class="flex-1 bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-2 px-3 text-sm text-on-surface placeholder:text-outline/50 focus:border-primary transition-colors rounded-t outline-none font-mono" ' +
            'placeholder="라벨명 입력 후 Enter" autocomplete="off" spellcheck="false" ' +
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_setupChipInputKeydown(\'setup-chip-label-input\',\'setup-chips-labels\');}" />' +
            '<button type="button" onclick="_setupChipInputKeydown(\'setup-chip-label-input\',\'setup-chips-labels\')" ' +
            'class="px-3 py-2 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors">' +
              '<span class="material-symbols-outlined text-sm">add</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="flex justify-between mt-8 pt-6 border-t border-outline-variant/10">' +
        '<button onclick="setupGoToStep(3)" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-surface-container-high text-on-surface-variant font-bold text-sm rounded-lg hover:bg-surface-bright transition-all">' +
          '<span class="material-symbols-outlined text-base">arrow_back</span><span>이전</span>' +
        '</button>' +
        '<button onclick="setupStep4Next()" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-sm rounded-lg transition-transform active:scale-95">' +
          '<span>미리보기 확인</span><span class="material-symbols-outlined text-base">preview</span>' +
        '</button>' +
      '</div>';
    container.appendChild(step4);
  }

  // ── Step 5: YAML Diff Preview + Apply ──────────────────────
  if (!document.getElementById('setup-step-5')) {
    var step5 = document.createElement('div');
    step5.id = 'setup-step-5';
    step5.className = 'hidden bg-surface-container p-8 rounded-xl ring-1 ring-outline-variant/10';
    step5.innerHTML =
      '<div class="flex items-center gap-3 mb-6">' +
        '<div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">' +
          '<span class="material-symbols-outlined text-primary">difference</span>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-headline text-lg font-bold text-on-surface">config.yml 미리보기</h3>' +
          '<p class="text-xs text-outline mt-0.5">적용될 변경사항을 확인하고 저장하세요</p>' +
        '</div>' +
      '</div>' +
      '<div class="bg-surface-container-lowest p-4 rounded-xl ring-1 ring-outline-variant/10 mb-4">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="w-2 h-2 rounded-full bg-tertiary"></span>' +
          '<span class="font-mono text-[10px] text-on-surface-variant uppercase tracking-tighter">config.yml</span>' +
        '</div>' +
        '<div id="setup-yaml-preview" class="min-h-[100px] overflow-x-auto">' +
          '<div class="text-outline text-xs">로딩 중...</div>' +
        '</div>' +
      '</div>' +
      '<div class="flex justify-between mt-8 pt-6 border-t border-outline-variant/10">' +
        '<button onclick="setupGoToStep(4)" ' +
        'class="flex items-center gap-2 px-5 py-2.5 bg-surface-container-high text-on-surface-variant font-bold text-sm rounded-lg hover:bg-surface-bright transition-all">' +
          '<span class="material-symbols-outlined text-base">arrow_back</span><span>이전</span>' +
        '</button>' +
        '<button id="setup-apply-btn" onclick="setupApplyConfig()" disabled ' +
        'class="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-sm rounded-lg transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">' +
          '<span class="material-symbols-outlined text-base">save</span><span>저장 및 완료</span>' +
        '</button>' +
      '</div>' +
      '<div id="setup-apply-status" class="hidden mt-4 text-xs text-outline text-center"></div>';
    container.appendChild(step5);
  }
}

/* ──────────────────────────────────────────────────────────────
   Step 2: Load repos from GitHub API
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function setupLoadRepos() {
  var repoSelectEl = document.getElementById('setup-repo');
  var repoLoadingEl = document.getElementById('setup-repo-loading');
  if (!repoSelectEl || !repoLoadingEl) return;
  var repoSelect = /** @type {HTMLSelectElement} */ (repoSelectEl);
  var safeLoading = /** @type {HTMLElement} */ (repoLoadingEl);

  repoSelect.innerHTML = '<option value="">저장소 선택...</option>';
  repoSelect.classList.add('hidden');
  safeLoading.classList.remove('hidden');
  safeLoading.innerHTML =
    '<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>' +
    '<span>저장소 불러오는 중...</span>';

  fetch('/api/setup/repos', {
    headers: { 'Authorization': 'Bearer ' + (_setupWizardData.githubToken || '') }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      safeLoading.classList.add('hidden');
      if (data.error || !Array.isArray(data.repos)) {
        safeLoading.innerHTML =
          '<span class="material-symbols-outlined text-sm text-[#f85149]">error</span>' +
          '<span class="text-[#f85149]">저장소를 불러오지 못했습니다.</span>';
        safeLoading.classList.remove('hidden');
        return;
      }
      data.repos.forEach(function (/** @type {{full_name:string,private:boolean}} */ repo) {
        var opt = document.createElement('option');
        opt.value = repo.full_name;
        opt.textContent = repo.full_name + (repo.private ? ' 🔒' : '');
        repoSelect.appendChild(opt);
      });
      repoSelect.classList.remove('hidden');
    })
    .catch(function () {
      safeLoading.innerHTML =
        '<span class="material-symbols-outlined text-sm text-[#f85149]">error</span>' +
        '<span class="text-[#f85149]">저장소를 불러오지 못했습니다.</span>';
      safeLoading.classList.remove('hidden');
    });
}

/* ──────────────────────────────────────────────────────────────
   Step 3: Label auto-creation
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function setupRunLabelCreation() {
  var labelsEl = document.getElementById('setup-labels-list');
  var nextBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('setup-step3-next-btn'));
  if (!labelsEl) return;
  var safeLabels = /** @type {HTMLElement} */ (labelsEl);

  var labels = (_setupWizardData.allowedLabels && _setupWizardData.allowedLabels.length > 0)
    ? _setupWizardData.allowedLabels
    : ['aqm-by'];

  safeLabels.innerHTML =
    '<div class="text-outline text-xs flex items-center gap-2">' +
    '<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>' +
    '<span>라벨 확인 중...</span></div>';
  if (nextBtn) nextBtn.disabled = true;

  fetch('/api/setup/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: _setupWizardData.repo || '',
      token: _setupWizardData.githubToken || '',
      labels: labels,
    }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!Array.isArray(data.results)) {
        safeLabels.innerHTML = '<div class="text-[#f85149] text-xs py-2">라벨 생성에 실패했습니다.</div>';
        if (nextBtn) nextBtn.disabled = false;
        return;
      }
      safeLabels.innerHTML = data.results.map(function (/** @type {{label:string,status:string}} */ item) {
        var icon, iconClass, statusText;
        if (item.status === 'created') {
          icon = 'add_circle'; iconClass = 'text-[#3fb950]'; statusText = '생성됨';
        } else if (item.status === 'skipped') {
          icon = 'check_circle'; iconClass = 'text-outline'; statusText = '이미 존재';
        } else {
          icon = 'error'; iconClass = 'text-[#f85149]'; statusText = '실패';
        }
        return '<div class="flex items-center gap-3 py-2.5">' +
          '<span class="material-symbols-outlined text-base ' + iconClass + '" style="font-variation-settings: \'FILL\' 1;">' + icon + '</span>' +
          '<span class="font-mono text-xs text-on-surface">' + _setupEscapeHtml(item.label) + '</span>' +
          '<span class="text-[10px] text-outline ml-auto">' + statusText + '</span>' +
          '</div>';
      }).join('');
      if (nextBtn) nextBtn.disabled = false;
    })
    .catch(function () {
      safeLabels.innerHTML = '<div class="text-[#f85149] text-xs py-2">서버 오류가 발생했습니다.</div>';
      if (nextBtn) nextBtn.disabled = false;
    });
}

/* ──────────────────────────────────────────────────────────────
   Step 4: Chip input (instanceOwners / allowedLabels)
   ────────────────────────────────────────────────────────────── */

/**
 * @param {string} listId
 * @param {string} value
 * @returns {void}
 */
function _setupAddChip(listId, value) {
  var trimmed = value.trim();
  if (!trimmed) return;
  var isOwners = listId === 'setup-chips-owners';
  var arr = (isOwners ? _setupWizardData.instanceOwners : _setupWizardData.allowedLabels) || [];
  if (arr.indexOf(trimmed) !== -1) return;
  arr.push(trimmed);
  if (isOwners) { _setupWizardData.instanceOwners = arr; } else { _setupWizardData.allowedLabels = arr; }
  _setupRenderChips(listId);
}

/**
 * @param {string} listId
 * @param {string} value
 * @returns {void}
 */
function _setupRemoveChip(listId, value) {
  var isOwners = listId === 'setup-chips-owners';
  var arr = (isOwners ? _setupWizardData.instanceOwners : _setupWizardData.allowedLabels) || [];
  var filtered = arr.filter(function (v) { return v !== value; });
  if (isOwners) { _setupWizardData.instanceOwners = filtered; } else { _setupWizardData.allowedLabels = filtered; }
  _setupRenderChips(listId);
}

/**
 * @param {string} listId
 * @returns {void}
 */
function _setupRenderChips(listId) {
  var container = document.getElementById(listId);
  if (!container) return;
  var isOwners = listId === 'setup-chips-owners';
  var arr = (isOwners ? _setupWizardData.instanceOwners : _setupWizardData.allowedLabels) || [];
  container.innerHTML = arr.map(function (v) {
    var escaped = _setupEscapeHtml(v);
    var escapedJs = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return '<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-full border border-primary/20">' +
      '<span>' + escaped + '</span>' +
      '<button type="button" onclick="_setupRemoveChip(\'' + listId + '\',\'' + escapedJs + '\')" ' +
      'class="ml-0.5 text-primary/60 hover:text-primary leading-none">' +
      '<span class="material-symbols-outlined" style="font-size:12px;">close</span></button>' +
      '</span>';
  }).join('');
}

/**
 * @param {string} inputId
 * @param {string} listId
 * @returns {void}
 */
function _setupChipInputKeydown(inputId, listId) {
  var inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  var input = /** @type {HTMLInputElement} */ (inputEl);
  var val = input.value.trim();
  if (val) {
    _setupAddChip(listId, val);
    input.value = '';
  }
}

/* ──────────────────────────────────────────────────────────────
   Utilities
   ────────────────────────────────────────────────────────────── */

/** @param {string} str @returns {string} */
function _setupEscapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────────────────────
   Step 1 debounce input listener
   ────────────────────────────────────────────────────────────── */

/** @returns {void} */
function initSetupView() {
  if (_setupListenerAttached) return;
  var tokenInputEl = document.getElementById('setup-github-token');
  if (!tokenInputEl) return;
  var tokenInput = /** @type {HTMLInputElement} */ (tokenInputEl);

  _setupListenerAttached = true;

  tokenInput.addEventListener('input', function () {
    if (_setupDebounceTimer !== null) {
      clearTimeout(_setupDebounceTimer);
      _setupDebounceTimer = null;
    }
    var val = tokenInput.value.trim();
    if (!val) return;
    _setupDebounceTimer = setTimeout(function () {
      _setupDebounceTimer = null;
      validateGitHubToken();
    }, 600);
  });
}

/* ──────────────────────────────────────────────────────────────
   Init
   ────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function () {
  _setupInjectSteps();
  initSetupView();
  setupGoToStep(1);
});
