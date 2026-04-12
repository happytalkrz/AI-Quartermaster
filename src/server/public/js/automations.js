// @ts-check
'use strict';

/**
 * @typedef {Object} AutomationTrigger
 * @property {string} type
 * @property {string} [event]
 * @property {string} [schedule]
 * @property {number} [threshold]
 */

/**
 * @typedef {Object} AutomationRuleFull
 * @property {string} id
 * @property {AutomationTrigger} trigger
 * @property {AutomationAction[]} actions
 * @property {boolean} [enabled]
 * @property {string} [description]
 */

/* ══════════════════════════════════════════════════════════════
   Automation Rules Management
   ══════════════════════════════════════════════════════════════ */

/** @type {AutomationRuleFull[]} */
var automationRules = [];

/** @returns {void} */
function loadAutomationRules() {
  var container = document.getElementById('rules-container');
  if (!container) return;

  container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>규칙을 로딩 중...</div>';

  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      automationRules = /** @type {AutomationRuleFull[]} */ ((data.config && data.config.automations) || []);
      renderAutomationRules();
    })
    .catch(function() {
      if (container) container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>규칙을 불러오는데 실패했습니다.</div>';
    });
}

/** @returns {void} */
function renderAutomationRules() {
  var container = document.getElementById('rules-container');
  if (!container) return;

  if (automationRules.length === 0) {
    container.innerHTML =
      '<div class="flex flex-col items-center justify-center py-16 text-center">' +
        '<span class="material-symbols-outlined text-5xl text-outline/30 mb-4">smart_toy</span>' +
        '<p class="text-sm font-bold text-on-surface mb-1">자동화 규칙이 없습니다</p>' +
        '<p class="text-xs text-outline mb-4">규칙을 추가하면 이벤트 발생 시 자동으로 액션이 실행됩니다.</p>' +
        '<button onclick="showAddRuleModal()" class="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors">' +
          '<span class="material-symbols-outlined text-sm">add</span>' +
          '<span>첫 번째 규칙 추가</span>' +
        '</button>' +
      '</div>';
    return;
  }

  container.innerHTML =
    '<div class="space-y-3">' +
      automationRules.map(function(rule) { return renderRuleCard(rule); }).join('') +
    '</div>';
}

/**
 * @param {AutomationRuleFull} rule
 * @returns {string}
 */
function renderRuleCard(rule) {
  var isEnabled = rule.enabled !== false;
  var triggerLabel = getTriggerLabel(rule.trigger);
  var actionsLabel = rule.actions.map(function(a) { return getActionLabel(a); }).join(', ');

  return (
    '<div class="bg-surface-container rounded-xl ring-1 ' + (isEnabled ? 'ring-outline-variant/20' : 'ring-outline-variant/10 opacity-60') + ' p-5 flex items-start gap-4">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="font-mono text-xs text-primary/70 bg-primary/10 px-2 py-0.5 rounded">' + esc(rule.id) + '</span>' +
          (rule.description ? '<span class="text-sm font-bold text-on-surface truncate">' + esc(rule.description) + '</span>' : '') +
        '</div>' +
        '<div class="flex items-center gap-3 text-xs text-outline mt-2">' +
          '<span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">bolt</span>' + esc(triggerLabel) + '</span>' +
          '<span class="text-outline/40">→</span>' +
          '<span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">play_arrow</span>' + esc(actionsLabel) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 shrink-0">' +
        '<button onclick="toggleAutomationRule(\'' + esc(rule.id) + '\')" title="' + (isEnabled ? '비활성화' : '활성화') + '" ' +
          'class="flex items-center gap-1 px-2 py-1 rounded text-xs font-bold transition-colors ' +
          (isEnabled ? 'text-[#3fb950] hover:bg-[#3fb950]/10' : 'text-outline hover:bg-surface-container-high') + '">' +
          '<span class="material-symbols-outlined text-sm">' + (isEnabled ? 'toggle_on' : 'toggle_off') + '</span>' +
        '</button>' +
        '<button onclick="showEditRuleModal(\'' + esc(rule.id) + '\')" title="편집" ' +
          'class="flex items-center gap-1 px-2 py-1 rounded text-xs text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors">' +
          '<span class="material-symbols-outlined text-sm">edit</span>' +
        '</button>' +
        '<button onclick="deleteAutomationRule(\'' + esc(rule.id) + '\')" title="삭제" ' +
          'class="flex items-center gap-1 px-2 py-1 rounded text-xs text-outline hover:text-error hover:bg-error/10 transition-colors">' +
          '<span class="material-symbols-outlined text-sm">delete</span>' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

/**
 * @param {AutomationTrigger | undefined} trigger
 * @returns {string}
 */
function getTriggerLabel(trigger) {
  if (!trigger) return '알 수 없음';
  if (trigger.type === 'cron') return 'Cron: ' + (trigger.schedule || '');
  if (trigger.type === 'event') return 'Event: ' + (trigger.event || '');
  if (trigger.type === 'rate-limit') return 'Rate Limit: ' + (trigger.threshold || '') + '회';
  return trigger.type;
}

/**
 * @param {AutomationAction | undefined} action
 * @returns {string}
 */
function getActionLabel(action) {
  if (!action) return '';
  /** @type {Record<string, string>} */
  var labels = { notify: '알림', pause: '일시정지', retry: '재시도', label: '라벨', close: '종료' };
  return labels[action.type] || action.type;
}

/**
 * @param {string} id
 * @returns {void}
 */
function toggleAutomationRule(id) {
  var rule = automationRules.find(function(r) { return r.id === id; });
  if (!rule) return;
  rule.enabled = !(rule.enabled !== false);
  saveAutomationRules(function() { renderAutomationRules(); });
}

/**
 * @param {string} id
 * @returns {void}
 */
function deleteAutomationRule(id) {
  showConfirm('이 자동화 규칙을 삭제하시겠습니까?', '').then(function(ok) {
    if (!ok) return;
    automationRules = automationRules.filter(function(r) { return r.id !== id; });
    saveAutomationRules(function() { renderAutomationRules(); });
  });
}

/**
 * @param {(() => void) | undefined} onSuccess
 * @returns {void}
 */
function saveAutomationRules(onSuccess) {
  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var config = data.config || {};
      config.automations = automationRules;
      return apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    })
    .then(function(r) {
      if (r.ok && onSuccess) onSuccess();
    })
    .catch(function() {});
}

/* ── Add / Edit Modal ─────────────────────────────────────────── */

/** @returns {void} */
function showAddRuleModal() {
  openRuleModal(null);
}

/**
 * @param {string} id
 * @returns {void}
 */
function showEditRuleModal(id) {
  var rule = automationRules.find(function(r) { return r.id === id; });
  if (!rule) return;
  openRuleModal(rule);
}

/**
 * @param {AutomationRuleFull | null} rule
 * @returns {void}
 */
function openRuleModal(rule) {
  var existingModal = document.getElementById('rule-modal');
  if (existingModal) existingModal.remove();

  var isEdit = rule !== null;
  var title = isEdit ? '규칙 편집' : '규칙 추가';

  var idVal          = rule ? rule.id : '';
  var descVal        = rule ? (rule.description || '') : '';
  var triggerType    = rule ? rule.trigger.type : 'event';
  var triggerEvent   = rule ? (rule.trigger.event || 'pr-merged') : 'pr-merged';
  var triggerSched   = rule ? (rule.trigger.schedule || 'daily') : 'daily';
  var triggerThresh  = rule ? (rule.trigger.threshold || 3) : 3;
  var actionType     = rule ? (rule.actions[0] ? rule.actions[0].type : 'notify') : 'notify';
  var enabledVal     = rule ? (rule.enabled !== false) : true;

  var fieldCls = 'w-full bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none';
  var labelCls = 'block text-xs font-bold text-outline mb-1';

  var html =
    '<div id="rule-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">' +
    '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-md mx-4 border border-outline-variant/20">' +
    '<div class="flex justify-between items-center mb-5">' +
      '<h3 class="text-base font-bold text-on-surface">' + title + '</h3>' +
      '<button onclick="closeRuleModal()" class="text-outline hover:text-on-surface"><span class="material-symbols-outlined">close</span></button>' +
    '</div>' +
    '<form id="rule-form" class="space-y-4">' +
      '<div>' +
        '<label class="' + labelCls + '">ID</label>' +
        '<input id="rule-id" type="text" value="' + esc(idVal) + '" ' + (isEdit ? 'readonly' : '') +
          ' placeholder="예: auto-notify-failure" class="' + fieldCls + (isEdit ? ' opacity-60 cursor-not-allowed' : '') + '">' +
      '</div>' +
      '<div>' +
        '<label class="' + labelCls + '">설명 (선택)</label>' +
        '<input id="rule-desc" type="text" value="' + esc(descVal) + '" placeholder="이 규칙에 대한 설명" class="' + fieldCls + '">' +
      '</div>' +
      '<div>' +
        '<label class="' + labelCls + '">트리거 유형</label>' +
        '<select id="rule-trigger-type" onchange="onTriggerTypeChange()" class="' + fieldCls + '">' +
          '<option value="event"' + (triggerType === 'event' ? ' selected' : '') + '>Event (이벤트)</option>' +
          '<option value="cron"' + (triggerType === 'cron' ? ' selected' : '') + '>Cron (스케줄)</option>' +
          '<option value="rate-limit"' + (triggerType === 'rate-limit' ? ' selected' : '') + '>Rate Limit (임계값)</option>' +
        '</select>' +
      '</div>' +
      '<div id="trigger-event-field"' + (triggerType !== 'event' ? ' class="hidden"' : '') + '>' +
        '<label class="' + labelCls + '">이벤트</label>' +
        '<select id="rule-trigger-event" class="' + fieldCls + '">' +
          '<option value="pr-merged"' + (triggerEvent === 'pr-merged' ? ' selected' : '') + '>PR Merged</option>' +
          '<option value="phase-failed"' + (triggerEvent === 'phase-failed' ? ' selected' : '') + '>Phase Failed</option>' +
        '</select>' +
      '</div>' +
      '<div id="trigger-cron-field"' + (triggerType !== 'cron' ? ' class="hidden"' : '') + '>' +
        '<label class="' + labelCls + '">스케줄</label>' +
        '<select id="rule-trigger-schedule" class="' + fieldCls + '">' +
          '<option value="daily"' + (triggerSched === 'daily' ? ' selected' : '') + '>매일 (daily)</option>' +
          '<option value="weekly"' + (triggerSched === 'weekly' ? ' selected' : '') + '>매주 (weekly)</option>' +
        '</select>' +
      '</div>' +
      '<div id="trigger-threshold-field"' + (triggerType !== 'rate-limit' ? ' class="hidden"' : '') + '>' +
        '<label class="' + labelCls + '">임계값 (회)</label>' +
        '<input id="rule-trigger-threshold" type="number" min="1" value="' + triggerThresh + '" class="' + fieldCls + '">' +
      '</div>' +
      '<div>' +
        '<label class="' + labelCls + '">액션</label>' +
        '<select id="rule-action-type" class="' + fieldCls + '">' +
          '<option value="notify"' + (actionType === 'notify' ? ' selected' : '') + '>알림 (notify)</option>' +
          '<option value="pause"' + (actionType === 'pause' ? ' selected' : '') + '>일시정지 (pause)</option>' +
          '<option value="retry"' + (actionType === 'retry' ? ' selected' : '') + '>재시도 (retry)</option>' +
          '<option value="label"' + (actionType === 'label' ? ' selected' : '') + '>라벨 (label)</option>' +
          '<option value="close"' + (actionType === 'close' ? ' selected' : '') + '>종료 (close)</option>' +
        '</select>' +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<input id="rule-enabled" type="checkbox"' + (enabledVal ? ' checked' : '') + ' class="w-4 h-4 accent-primary">' +
        '<label for="rule-enabled" class="text-sm text-on-surface">활성화</label>' +
      '</div>' +
      '<div class="flex gap-2 pt-2">' +
        '<button type="submit" class="flex-1 bg-primary text-on-primary font-bold py-2 px-4 rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">' +
          '<span class="material-symbols-outlined text-sm">save</span><span>저장</span>' +
        '</button>' +
        '<button type="button" onclick="closeRuleModal()" class="px-4 py-2 border border-outline-variant/30 rounded-lg text-outline hover:bg-surface-container-high transition-colors">취소</button>' +
      '</div>' +
    '</form>' +
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', html);
  var formEl = document.getElementById('rule-form');
  if (formEl) formEl.addEventListener('submit', function(e) {
    e.preventDefault();
    submitRuleForm(isEdit);
  });
}

/** @returns {void} */
function onTriggerTypeChange() {
  var typeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('rule-trigger-type'));
  var type = typeEl ? typeEl.value : 'event';
  var eventField = document.getElementById('trigger-event-field');
  var cronField = document.getElementById('trigger-cron-field');
  var thresholdField = document.getElementById('trigger-threshold-field');
  if (eventField) eventField.classList.toggle('hidden', type !== 'event');
  if (cronField) cronField.classList.toggle('hidden', type !== 'cron');
  if (thresholdField) thresholdField.classList.toggle('hidden', type !== 'rate-limit');
}

/** @returns {void} */
function closeRuleModal() {
  var modal = document.getElementById('rule-modal');
  if (modal) modal.remove();
}

/**
 * @param {boolean} isEdit
 * @returns {void}
 */
function submitRuleForm(isEdit) {
  var idEl = /** @type {HTMLInputElement | null} */ (document.getElementById('rule-id'));
  var id = (idEl ? idEl.value : '').trim();
  if (!id) { alert('ID를 입력해주세요.'); return; }

  var triggerTypeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('rule-trigger-type'));
  var triggerType = triggerTypeEl ? triggerTypeEl.value : 'event';
  var trigger = /** @type {AutomationTrigger} */ ({ type: triggerType });
  if (triggerType === 'event') {
    var eventEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('rule-trigger-event'));
    trigger.event = eventEl ? eventEl.value : '';
  } else if (triggerType === 'cron') {
    var schedEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('rule-trigger-schedule'));
    trigger.schedule = schedEl ? schedEl.value : '';
  } else if (triggerType === 'rate-limit') {
    var threshEl = /** @type {HTMLInputElement | null} */ (document.getElementById('rule-trigger-threshold'));
    trigger.threshold = parseInt(threshEl ? threshEl.value : '1', 10) || 1;
  }

  var descEl = /** @type {HTMLInputElement | null} */ (document.getElementById('rule-desc'));
  var actionTypeEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('rule-action-type'));
  var enabledEl = /** @type {HTMLInputElement | null} */ (document.getElementById('rule-enabled'));

  var rule = /** @type {AutomationRuleFull} */ ({
    id: id,
    description: (descEl ? descEl.value.trim() : '') || undefined,
    trigger: trigger,
    actions: [{ type: actionTypeEl ? actionTypeEl.value : 'notify' }],
    enabled: enabledEl ? enabledEl.checked : true
  });

  if (isEdit) {
    var idx = automationRules.findIndex(function(r) { return r.id === id; });
    if (idx !== -1) automationRules[idx] = rule;
  } else {
    var duplicate = automationRules.find(function(r) { return r.id === id; });
    if (duplicate) { alert('이미 같은 ID의 규칙이 존재합니다.'); return; }
    automationRules.push(rule);
  }

  closeRuleModal();
  saveAutomationRules(function() { renderAutomationRules(); });
}

window.loadAutomationRules  = loadAutomationRules;
window.toggleAutomationRule = toggleAutomationRule;
window.deleteAutomationRule = deleteAutomationRule;
window.showAddRuleModal     = showAddRuleModal;
window.showEditRuleModal    = showEditRuleModal;
window.closeRuleModal       = closeRuleModal;
window.onTriggerTypeChange  = onTriggerTypeChange;
