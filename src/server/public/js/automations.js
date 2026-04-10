'use strict';

/* ══════════════════════════════════════════════════════════════
   Automation Rules — Constants
   ══════════════════════════════════════════════════════════════ */
var TRIGGER_LABELS = {
  issue_labeled:  '라벨 지정',
  issue_opened:   '이슈 생성',
  issue_assigned: '담당자 지정',
  scheduled:      '예약 실행'
};

var ACTION_LABELS = {
  start_pipeline: '파이프라인 시작',
  skip_pipeline:  '파이프라인 건너뛰기',
  notify:         '알림 전송',
  set_label:      '라벨 설정'
};

/* ══════════════════════════════════════════════════════════════
   Automation Rules — State
   ══════════════════════════════════════════════════════════════ */
var currentRules = [];
var editingRuleId = null;

/* ══════════════════════════════════════════════════════════════
   Automation Rules — API
   ══════════════════════════════════════════════════════════════ */
function loadRules() {
  var container = document.getElementById('automations-rules-view');
  if (!container) return;

  container.innerHTML =
    '<div class="flex items-center justify-center py-16 text-outline text-sm">' +
      '<span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>' +
      '규칙을 불러오는 중...' +
    '</div>';

  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var config = data.config || {};
      var automations = config.automations || {};
      currentRules = Array.isArray(automations.rules) ? automations.rules : [];
      renderRulesView();
    })
    .catch(function() {
      currentRules = [];
      renderRulesView();
    });
}

function saveRule(rule) {
  var isNew = !rule.id;

  // Generate ID for new rules
  if (isNew) {
    rule.id = 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    rule.createdAt = Date.now();
  }
  rule.updatedAt = Date.now();

  // Get current config, update automations.rules, then save entire config
  return apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var config = data.config || {};
      var automations = config.automations || { enabled: false, rules: [] };

      if (isNew) {
        automations.rules.push(rule);
      } else {
        var idx = automations.rules.findIndex(function(r) { return r.id === rule.id; });
        if (idx >= 0) {
          automations.rules[idx] = rule;
        } else {
          automations.rules.push(rule);
        }
      }

      return apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automations: automations })
      });
    })
    .then(function(r) {
      if (!r.ok) return Promise.reject(new Error('Save failed: ' + r.status));
      return r.json().then(function() { return { rule: rule }; });
    });
}

function deleteRule(id) {
  // Get current config, remove rule from automations.rules, then save entire config
  return apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var config = data.config || {};
      var automations = config.automations || { enabled: false, rules: [] };

      automations.rules = automations.rules.filter(function(r) { return r.id !== id; });

      return apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automations: automations })
      });
    })
    .then(function(r) {
      if (!r.ok) return Promise.reject(new Error('Delete failed: ' + r.status));
    });
}

function patchRuleToggle(id, enabled) {
  // Get current config, update rule enabled state, then save entire config
  return apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var config = data.config || {};
      var automations = config.automations || { enabled: false, rules: [] };

      var rule = automations.rules.find(function(r) { return r.id === id; });
      if (!rule) return Promise.reject(new Error('Rule not found'));

      rule.enabled = enabled;
      rule.updatedAt = Date.now();

      return apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automations: automations })
      });
    })
    .then(function(r) {
      if (!r.ok) return Promise.reject(new Error('Toggle failed: ' + r.status));
      return r.json().then(function() {
        var rule = currentRules.find(function(r) { return r.id === id; });
        return { rule: Object.assign({}, rule, { enabled: enabled }) };
      });
    });
}

/* ══════════════════════════════════════════════════════════════
   Automation Rules — Render
   ══════════════════════════════════════════════════════════════ */
function renderRulesView() {
  var container = document.getElementById('automations-rules-view');
  if (!container) return;

  var bodyHtml;
  if (currentRules.length === 0) {
    bodyHtml =
      '<div class="flex flex-col items-center justify-center py-16 text-center">' +
        '<span class="material-symbols-outlined text-5xl text-outline/30 mb-4">rule</span>' +
        '<p class="text-sm font-bold text-on-surface mb-1">등록된 규칙이 없습니다</p>' +
        '<p class="text-xs text-outline">자동화 규칙을 추가하여 파이프라인을 자동으로 제어하세요.</p>' +
      '</div>';
  } else {
    bodyHtml =
      '<div class="space-y-3">' +
        currentRules.map(renderRuleCard).join('') +
      '</div>';
  }

  container.innerHTML =
    '<div class="flex items-center justify-between mb-4">' +
      '<p class="text-xs text-outline">' + currentRules.length + '개의 규칙</p>' +
      '<button onclick="openRuleModal(null)" class="flex items-center gap-1.5 px-3 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">' +
        '<span class="material-symbols-outlined text-sm">add</span>' +
        '<span>규칙 추가</span>' +
      '</button>' +
    '</div>' +
    bodyHtml;
}

function renderRuleCard(rule) {
  var triggerLabel = TRIGGER_LABELS[rule.trigger] || esc(rule.trigger);
  var actionLabel  = ACTION_LABELS[rule.action]  || esc(rule.action);
  var enabledBadge = rule.enabled
    ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary/20 text-primary">활성</span>'
    : '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-surface-variant text-outline">비활성</span>';

  var conditionsHtml = '';
  if (rule.conditions && Object.keys(rule.conditions).length > 0) {
    var chips = Object.keys(rule.conditions).map(function(k) {
      return '<span class="font-mono text-[10px] bg-surface-container-high px-1.5 py-0.5 rounded">' +
        esc(k) + ': ' + esc(rule.conditions[k]) + '</span>';
    });
    conditionsHtml = '<div class="flex flex-wrap gap-1 mt-2">' + chips.join('') + '</div>';
  }

  var toggleIcon  = rule.enabled ? 'toggle_on'  : 'toggle_off';
  var toggleColor = rule.enabled ? 'text-primary' : 'text-outline';

  return '<div class="bg-surface-container p-4 rounded-xl ring-1 ring-outline-variant/20 flex items-start gap-4">' +
    '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center gap-2 mb-1">' +
        '<span class="text-sm font-bold text-on-surface">' + esc(rule.name) + '</span>' +
        enabledBadge +
      '</div>' +
      '<div class="flex items-center gap-1.5 text-xs text-outline">' +
        '<span class="material-symbols-outlined text-sm">bolt</span>' +
        '<span>' + triggerLabel + '</span>' +
        '<span class="material-symbols-outlined text-sm">arrow_forward</span>' +
        '<span>' + actionLabel + '</span>' +
      '</div>' +
      conditionsHtml +
    '</div>' +
    '<div class="flex items-center gap-1 shrink-0">' +
      '<button onclick="handleRuleToggle(\'' + esc(rule.id) + '\',' + String(!rule.enabled) + ')" ' +
        'class="p-1.5 rounded-lg ' + toggleColor + ' hover:bg-surface-container-high transition-colors" ' +
        'title="' + (rule.enabled ? '비활성화' : '활성화') + '">' +
        '<span class="material-symbols-outlined text-xl">' + toggleIcon + '</span>' +
      '</button>' +
      '<button onclick="openRuleModal(\'' + esc(rule.id) + '\')" ' +
        'class="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors" title="수정">' +
        '<span class="material-symbols-outlined text-sm">edit</span>' +
      '</button>' +
      '<button onclick="handleRuleDelete(\'' + esc(rule.id) + '\')" ' +
        'class="p-1.5 rounded-lg text-outline hover:text-error hover:bg-error/10 transition-colors" title="삭제">' +
        '<span class="material-symbols-outlined text-sm">delete</span>' +
      '</button>' +
    '</div>' +
  '</div>';
}

/* ══════════════════════════════════════════════════════════════
   Automation Rules — Modal
   ══════════════════════════════════════════════════════════════ */
function createRuleModal() {
  var div = document.createElement('div');
  div.id = 'rule-modal';
  div.className = 'hidden fixed inset-0 z-50 items-center justify-center bg-black/60 backdrop-blur-sm';

  var triggerOptions = Object.keys(TRIGGER_LABELS).map(function(k) {
    return '<option value="' + k + '">' + TRIGGER_LABELS[k] + '</option>';
  }).join('');
  var actionOptions = Object.keys(ACTION_LABELS).map(function(k) {
    return '<option value="' + k + '">' + ACTION_LABELS[k] + '</option>';
  }).join('');

  var inputCls = 'w-full bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary';

  div.innerHTML =
    '<div class="bg-surface-container w-full max-w-md mx-4 rounded-2xl ring-1 ring-outline-variant/20 shadow-xl">' +
      '<div class="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">' +
        '<h3 id="rule-modal-title" class="font-headline font-bold text-on-surface text-sm">규칙 추가</h3>' +
        '<button onclick="closeRuleModal()" class="p-1 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors">' +
          '<span class="material-symbols-outlined text-sm">close</span>' +
        '</button>' +
      '</div>' +
      '<div class="px-6 py-4 space-y-4">' +
        '<div>' +
          '<label class="block text-xs font-bold text-outline mb-1.5" for="rule-name">규칙 이름</label>' +
          '<input id="rule-name" type="text" placeholder="예: 버그 라벨 자동 처리" class="' + inputCls + '">' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-bold text-outline mb-1.5" for="rule-trigger">트리거</label>' +
          '<select id="rule-trigger" class="' + inputCls + '">' + triggerOptions + '</select>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-bold text-outline mb-1.5" for="rule-action">액션</label>' +
          '<select id="rule-action" class="' + inputCls + '">' + actionOptions + '</select>' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-bold text-outline mb-1.5" for="rule-conditions">조건 (JSON, 선택사항)</label>' +
          '<input id="rule-conditions" type="text" placeholder=\'{"label": "bug"}\' class="' + inputCls + ' font-mono text-xs">' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-bold text-outline mb-1.5" for="rule-action-params">액션 파라미터 (JSON, 선택사항)</label>' +
          '<input id="rule-action-params" type="text" placeholder=\'{"channel": "#alerts"}\' class="' + inputCls + ' font-mono text-xs">' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<input id="rule-enabled" type="checkbox" class="rounded border-outline-variant/30 bg-surface-container-high text-primary focus:ring-primary focus:ring-1">' +
          '<label for="rule-enabled" class="text-xs font-bold text-on-surface cursor-pointer">활성화</label>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-outline-variant/10">' +
        '<button onclick="closeRuleModal()" class="px-4 py-2 text-xs font-bold text-outline hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">취소</button>' +
        '<button id="rule-save-btn" onclick="handleRuleSave()" class="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors">' +
          '<span class="material-symbols-outlined text-sm">save</span>' +
          '<span>저장</span>' +
        '</button>' +
      '</div>' +
    '</div>';

  return div;
}

function openRuleModal(ruleId) {
  editingRuleId = ruleId || null;
  var rule = ruleId ? currentRules.find(function(r) { return r.id === ruleId; }) : null;

  var modal = document.getElementById('rule-modal');
  if (!modal) {
    modal = createRuleModal();
    document.body.appendChild(modal);
  }

  document.getElementById('rule-modal-title').textContent = rule ? '규칙 수정' : '규칙 추가';
  document.getElementById('rule-name').value          = rule ? rule.name    : '';
  document.getElementById('rule-trigger').value       = rule ? rule.trigger : 'issue_labeled';
  document.getElementById('rule-action').value        = rule ? rule.action  : 'start_pipeline';
  document.getElementById('rule-enabled').checked     = rule ? rule.enabled : true;
  document.getElementById('rule-conditions').value    = (rule && rule.conditions)   ? JSON.stringify(rule.conditions)   : '';
  document.getElementById('rule-action-params').value = (rule && rule.actionParams) ? JSON.stringify(rule.actionParams) : '';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('rule-name').focus();
}

function closeRuleModal() {
  var modal = document.getElementById('rule-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  editingRuleId = null;
}

/* ══════════════════════════════════════════════════════════════
   Automation Rules — Event Handlers
   ══════════════════════════════════════════════════════════════ */
function handleRuleSave() {
  var name = (document.getElementById('rule-name').value || '').trim();
  if (!name) {
    document.getElementById('rule-name').focus();
    return;
  }

  var conditionsRaw   = (document.getElementById('rule-conditions').value    || '').trim();
  var actionParamsRaw = (document.getElementById('rule-action-params').value || '').trim();
  var conditions   = null;
  var actionParams = null;

  if (conditionsRaw) {
    try { conditions = JSON.parse(conditionsRaw); } catch (e) {
      alert('조건 JSON 형식이 올바르지 않습니다.');
      return;
    }
  }
  if (actionParamsRaw) {
    try { actionParams = JSON.parse(actionParamsRaw); } catch (e) {
      alert('액션 파라미터 JSON 형식이 올바르지 않습니다.');
      return;
    }
  }

  var rule = {
    name:    name,
    trigger: document.getElementById('rule-trigger').value,
    action:  document.getElementById('rule-action').value,
    enabled: document.getElementById('rule-enabled').checked
  };
  if (conditions)   rule.conditions   = conditions;
  if (actionParams) rule.actionParams = actionParams;
  if (editingRuleId) rule.id = editingRuleId;

  var btn = document.getElementById('rule-save-btn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>저장 중...</span>';

  saveRule(rule)
    .then(function(data) {
      var saved = (data && data.rule) ? data.rule : data;
      if (editingRuleId) {
        var idx = currentRules.findIndex(function(r) { return r.id === editingRuleId; });
        if (idx >= 0) currentRules[idx] = saved;
      } else {
        currentRules.push(saved);
      }
      closeRuleModal();
      renderRulesView();
    })
    .catch(function() {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    });
}

function handleRuleToggle(id, enabled) {
  var rule = currentRules.find(function(r) { return r.id === id; });
  if (!rule) return;

  patchRuleToggle(id, enabled)
    .then(function(data) {
      var updated = (data && data.rule) ? data.rule : Object.assign({}, rule, { enabled: enabled });
      var idx = currentRules.findIndex(function(r) { return r.id === id; });
      if (idx >= 0) currentRules[idx] = updated;
      renderRulesView();
    })
    .catch(function() {
      alert('상태 변경에 실패했습니다.');
    });
}

function handleRuleDelete(id) {
  var rule = currentRules.find(function(r) { return r.id === id; });
  if (!rule) return;

  showConfirm('규칙 삭제', '"' + rule.name + '" 규칙을 삭제하시겠습니까?')
    .then(function(confirmed) {
      if (!confirmed) return;
      deleteRule(id)
        .then(function() {
          currentRules = currentRules.filter(function(r) { return r.id !== id; });
          renderRulesView();
        })
        .catch(function() {
          alert('삭제에 실패했습니다.');
        });
    });
}

/* ══════════════════════════════════════════════════════════════
   Automations View — Integration
   ══════════════════════════════════════════════════════════════ */
var ACTIVE_TAB_CLASS   = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors bg-primary/10 text-primary';
var INACTIVE_TAB_CLASS = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors text-outline hover:text-on-surface';

function initAutomationsRulesUI() {
  // Inject "Rules" tab button into the view toggle bar
  var toggleBar = document.querySelector('#view-automations .bg-surface-container-high.rounded-lg');
  if (toggleBar && !document.getElementById('btn-automations-rules')) {
    var btn = document.createElement('button');
    btn.id        = 'btn-automations-rules';
    btn.className = INACTIVE_TAB_CLASS;
    btn.onclick   = function() { setAutomationsView('rules'); };
    btn.innerHTML = '<span class="material-symbols-outlined text-sm">rule</span><span>Rules</span>';
    toggleBar.appendChild(btn);
  }

  // Inject rules panel div into the automations view
  var view = document.getElementById('view-automations');
  if (view && !document.getElementById('automations-rules-view')) {
    var panel = document.createElement('div');
    panel.id        = 'automations-rules-view';
    panel.className = 'hidden';
    view.appendChild(panel);
  }
}

// Extend setAutomationsView to handle the 'rules' tab
(function() {
  var orig = window.setAutomationsView;
  window.setAutomationsView = function(view) {
    var rulesBtn  = document.getElementById('btn-automations-rules');
    var rulesView = document.getElementById('automations-rules-view');

    if (view === 'rules') {
      var listView   = document.getElementById('automations-list-view');
      var kanbanView = document.getElementById('automations-kanban-view');
      var btnList    = document.getElementById('btn-automations-list');
      var btnKanban  = document.getElementById('btn-automations-kanban');

      if (listView)   listView.classList.add('hidden');
      if (kanbanView) kanbanView.classList.add('hidden');
      if (rulesView)  rulesView.classList.remove('hidden');
      if (btnList)    btnList.className   = INACTIVE_TAB_CLASS;
      if (btnKanban)  btnKanban.className = INACTIVE_TAB_CLASS;
      if (rulesBtn)   rulesBtn.className  = ACTIVE_TAB_CLASS;

      localStorage.setItem('aqm-automations-view', 'rules');
      loadRules();
    } else {
      if (rulesView) rulesView.classList.add('hidden');
      if (rulesBtn)  rulesBtn.className = INACTIVE_TAB_CLASS;
      if (typeof orig === 'function') orig(view);
    }
  };
})();

// Extend renderAutomationsPanel to handle the 'rules' tab on navigation
(function() {
  var orig = window.renderAutomationsPanel;
  window.renderAutomationsPanel = function() {
    var stored = localStorage.getItem('aqm-automations-view') || 'list';
    if (stored === 'rules') {
      setAutomationsView('rules');
    } else if (typeof orig === 'function') {
      orig();
    }
  };
})();

/* ══════════════════════════════════════════════════════════════
   Global Exports & Init
   ══════════════════════════════════════════════════════════════ */
window.openRuleModal    = openRuleModal;
window.closeRuleModal   = closeRuleModal;
window.handleRuleSave   = handleRuleSave;
window.handleRuleToggle = handleRuleToggle;
window.handleRuleDelete = handleRuleDelete;

document.addEventListener('DOMContentLoaded', function() {
  initAutomationsRulesUI();
});
