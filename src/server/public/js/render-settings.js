// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Settings Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {ProjectConfig} project
 * @returns {string}
 */
function renderProjectCard(project) {
  var html = '<div class="bg-surface-container-low p-5 rounded-xl transition-all hover:bg-surface-container flex flex-col justify-between group">';
  html += '<div class="flex justify-between items-start mb-4">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="material-symbols-outlined text-primary text-xl">account_tree</span>';
  html += '<h3 class="font-bold text-on-surface">' + esc(project.repo) + '</h3>';
  html += '</div>';
  html += '<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">';
  if (project.repo) {
    html += '<button onclick="editProject(\'' + esc(project.repo) + '\')" class="p-1 hover:text-primary transition-colors" title="' + (t('edit') || 'Edit') + '">';
    html += '<span class="material-symbols-outlined text-sm">edit</span>';
    html += '</button>';
    html += '<button onclick="deleteProject(\'' + esc(project.repo) + '\')" class="p-1 hover:text-error transition-colors" title="' + t('delete') + '">';
    html += '<span class="material-symbols-outlined text-sm">delete</span>';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  html += '<div class="space-y-3">';
  html += '<div class="flex flex-col">';
  html += '<span class="text-[10px] uppercase text-outline tracking-wider font-bold">' + t('localPath') + '</span>';
  html += '<code class="font-mono text-xs text-on-surface-variant truncate bg-surface-container-highest/30 p-1.5 rounded">' + esc(project.path) + '</code>';
  html += '</div>';

  if (project.baseBranch) {
    html += '<div class="flex justify-between items-end">';
    html += '<div class="flex flex-col">';
    html += '<span class="text-[10px] uppercase text-outline tracking-wider font-bold">' + t('branch') + '</span>';
    html += '<span class="text-sm font-medium">' + esc(project.baseBranch) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  if (project.mode) {
    html += '<div class="flex items-center gap-2 px-2 py-1 rounded-full bg-primary/10 w-fit">';
    html += '<span class="text-[10px] font-bold text-primary uppercase">' + esc(project.mode) + '</span>';
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

/**
 * @param {AqmConfig|null} config
 * @returns {void}
 */
function renderSettingsView(config) {
  if (!config) {
    var container = document.getElementById('settings-content');
    if (container) {
      container.innerHTML = '<div class="col-span-full flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정을 불러올 수 없습니다.</div>';
    }
    return;
  }

  // 프로젝트 목록 렌더링
  var container = document.getElementById('settings-content');
  if (container && config.projects && config.projects.length > 0) {
    var html = '';
    config.projects.forEach(function(project) {
      html += renderProjectCard(project);
    });
    container.innerHTML = html;
  }

  // 각 탭별로 폼 렌더링
  renderTabForm('general', config.general || null);
  renderTabForm('safety', config.safety || null);
  renderTabForm('review', config.review || null);

  // 저장된 탭 선택 복원 또는 기본 탭 설정
  var savedTab = localStorage.getItem('aqm-selected-tab') || 'general';
  setSettingsTab(savedTab);
}

/**
 * @param {string} tabName
 * @param {Record<string, *>|null} data
 * @returns {void}
 */
function renderTabForm(tabName, data) {
  var container = document.getElementById(tabName + '-settings-form');
  if (!container || !data) return;

  var html = '';

  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      html += renderFormField(key, data[key], tabName + '.' + key);
    }
  }

  container.innerHTML = html;
}

/** @type {Record<string, string>} */
var FIELD_DISPLAY_LABELS = {
  'general.instanceLabel': 'Instance Label',
  'general.instanceOwners': 'Instance Owners',
};

/**
 * @param {string} key
 * @param {*} value
 * @param {string} configPath
 * @returns {string}
 */
function renderFormField(key, value, configPath) {
  var fieldId = 'field-' + configPath.replace(/\./g, '-');
  var isMasked = typeof value === 'string' && value.includes('********');
  var isReadonly = isMasked;
  var displayLabel = FIELD_DISPLAY_LABELS[configPath] || key;

  var html = '<label class="block">';
  html += '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-2">' + esc(displayLabel) + '</span>';

  if (typeof value === 'boolean') {
    html += renderCheckboxInput(fieldId, value, configPath, isReadonly);
  } else if (typeof value === 'number') {
    html += renderNumberInput(fieldId, value, configPath, isReadonly);
  } else if (Array.isArray(value)) {
    if (configPath === 'general.instanceOwners') {
      html += renderInstanceOwnersInput(fieldId, value, configPath, isReadonly);
    } else {
      html += renderArrayInput(fieldId, value, configPath, isReadonly);
    }
  } else if (typeof value === 'object' && value !== null) {
    html += renderObjectInput(fieldId, value, configPath, isReadonly);
  } else {
    html += renderTextInput(fieldId, String(value), configPath, isReadonly, isMasked);
  }

  html += '</label>';
  return html;
}

/**
 * @param {string} baseClasses
 * @param {boolean} isReadonly
 * @param {string} [additionalClasses]
 * @returns {string}
 */
function buildInputClasses(baseClasses, isReadonly, additionalClasses) {
  var classes = baseClasses;
  if (isReadonly) classes += ' opacity-60 cursor-not-allowed';
  if (additionalClasses) classes += ' ' + additionalClasses;
  return classes;
}

/**
 * @param {string} fieldId
 * @param {string} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @param {boolean} isMasked
 * @returns {string}
 */
function renderTextInput(fieldId, value, configPath, isReadonly, isMasked) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none',
    isReadonly,
    isMasked ? 'bg-[#f85149]/5 border-[#f85149]/20 text-[#f85149]' : ''
  );

  return '<input type="text" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'value="' + esc(value) + '" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '/>';
}

/**
 * @param {string} fieldId
 * @param {number} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @returns {string}
 */
function renderNumberInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none',
    isReadonly
  );

  return '<input type="number" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'value="' + value + '" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '/>';
}

/**
 * @param {string} fieldId
 * @param {boolean} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @returns {string}
 */
function renderCheckboxInput(fieldId, value, configPath, isReadonly) {
  var classes = 'w-4 h-4 text-primary border border-outline-variant/30 rounded focus:ring-1 focus:ring-primary bg-surface-container-highest/40';
  if (isReadonly) {
    classes += ' opacity-60 cursor-not-allowed';
  }

  return '<div class="flex items-center justify-between p-3 bg-surface-container-low rounded-lg">' +
         '<span class="text-sm font-bold">' + (value ? t('enabled') || 'Enabled' : t('disabled') || 'Disabled') + '</span>' +
         '<input type="checkbox" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         (value ? 'checked' : '') + ' ' +
         'class="' + classes + '"' +
         (isReadonly ? ' disabled' : '') + '/>' +
         '</div>';
}

/**
 * @param {string} fieldId
 * @param {string[]} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @returns {string}
 */
function renderInstanceOwnersInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none',
    isReadonly
  );
  var commaSeparated = Array.isArray(value) ? value.join(', ') : '';

  return '<input type="text" id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'data-input-type="comma-array" ' +
         'value="' + esc(commaSeparated) + '" ' +
         'placeholder="owner1, owner2, owner3" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '/>' +
         '<div class="text-[10px] text-outline/70 mt-1">쉼표로 구분 (예: user1, user2)</div>';
}

/**
 * @param {string} fieldId
 * @param {*[]} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @returns {string}
 */
function renderArrayInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none font-mono',
    isReadonly
  );
  var arrayText = JSON.stringify(value, null, 2);

  return '<textarea id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'rows="4" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '>' +
         esc(arrayText) +
         '</textarea>' +
         '<div class="text-[10px] text-outline/70 mt-1">JSON</div>';
}

/**
 * @param {string} fieldId
 * @param {Record<string, *>} value
 * @param {string} configPath
 * @param {boolean} isReadonly
 * @returns {string}
 */
function renderObjectInput(fieldId, value, configPath, isReadonly) {
  var classes = buildInputClasses(
    'w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none font-mono',
    isReadonly
  );
  var objectText = JSON.stringify(value, null, 2);

  return '<textarea id="' + fieldId + '" ' +
         'data-config-path="' + esc(configPath) + '" ' +
         'rows="6" ' +
         'class="' + classes + '"' +
         (isReadonly ? ' readonly' : '') + '>' +
         esc(objectText) +
         '</textarea>' +
         '<div class="text-[10px] text-outline/70 mt-1">JSON</div>';
}
