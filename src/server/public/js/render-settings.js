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

  if (project.commands) {
    var cmdLabels = [];
    if (project.commands.test) cmdLabels.push('test');
    if (project.commands.typecheck) cmdLabels.push('typecheck');
    if (project.commands.build) cmdLabels.push('build');
    if (project.commands.lint) cmdLabels.push('lint');
    if (project.commands.preInstall) cmdLabels.push('preInstall');
    if (cmdLabels.length > 0) {
      html += '<div class="flex flex-wrap gap-1 mt-1">';
      cmdLabels.forEach(function(cmd) {
        html += '<span class="text-[9px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-mono">' + esc(cmd) + '</span>';
      });
      html += '</div>';
    }
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

  // Claude CLI maxTurns / maxTurnsPerMode 필드 바인딩
  bindCommandsCliFields(config);

  // Basic 탭 렌더링
  renderBasicTab(config);

  // Advanced 탭 JSON 카드 렌더링
  renderAdvancedTab(config);

  // 저장된 모드 탭 복원 (Basic/Advanced)
  var savedModeTab = localStorage.getItem('aqm-selected-mode-tab') || 'basic';
  setSettingsModeTab(savedModeTab);

  // 저장된 서브 탭 복원 (general/safety/review)
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
  // general
  'general.projectName': 'Project Name',
  'general.instanceLabel': 'Instance Label',
  'general.instanceOwners': 'Instance Owners',
  'general.logLevel': 'Log Level',
  'general.logDir': 'Log Directory',
  'general.dryRun': 'Dry Run',
  'general.locale': 'Locale',
  'general.concurrency': 'Concurrency',
  'general.targetRoot': 'Target Root',
  'general.stuckTimeoutMs': 'Stuck Timeout (ms)',
  'general.pollingIntervalMs': 'Polling Interval (ms)',
  'general.maxJobs': 'Max Jobs',
  'general.autoUpdate': 'Auto Update',
  // safety
  'safety.sensitivePaths': 'Sensitive Paths',
  'safety.maxPhases': 'Max Phases',
  'safety.maxRetries': 'Max Retries',
  'safety.maxTotalDurationMs': 'Max Total Duration (ms)',
  'safety.maxFileChanges': 'Max File Changes',
  'safety.maxInsertions': 'Max Insertions',
  'safety.maxDeletions': 'Max Deletions',
  'safety.requireTests': 'Require Tests',
  'safety.blockDirectBasePush': 'Block Direct Base Push',
  'safety.timeouts': 'Timeouts',
  'safety.stopConditions': 'Stop Conditions',
  'safety.allowedLabels': 'Allowed Labels',
  'safety.rollbackStrategy': 'Rollback Strategy',
  'safety.feasibilityCheck': 'Feasibility Check',
  'safety.strict': 'Strict Mode',
  'safety.rules': 'Rules',
  // review
  'review.enabled': 'Enabled',
  'review.rounds': 'Review Rounds',
  'review.simplify': 'Simplify',
  'review.unifiedMode': 'Unified Mode',
};

/** @type {Record<string, string>} */
var FIELD_DESCRIPTIONS = {
  'general.projectName': '이 AQM 인스턴스의 프로젝트 이름',
  'general.instanceLabel': '대시보드에 표시될 인스턴스 식별 레이블',
  'general.instanceOwners': '이 인스턴스를 소유한 GitHub 사용자 목록',
  'general.logLevel': '로그 출력 레벨 (debug, info, warn, error)',
  'general.logDir': '로그 파일이 저장될 디렉토리 경로',
  'general.dryRun': '활성화 시 실제 변경 없이 파이프라인을 시뮬레이션',
  'general.locale': 'UI 및 메시지에 사용할 언어 (ko, en)',
  'general.concurrency': '동시에 실행할 수 있는 최대 작업 수',
  'general.stuckTimeoutMs': '작업이 멈춘 것으로 판단하기까지의 대기 시간',
  'general.pollingIntervalMs': '이슈 폴링 주기 (밀리초)',
  'general.maxJobs': '큐에 허용되는 최대 잡 수',
  'general.autoUpdate': '새 버전이 있을 때 자동으로 업데이트',
  'safety.maxPhases': '파이프라인 내 최대 허용 Phase 수',
  'safety.maxRetries': '실패 시 최대 재시도 횟수',
  'safety.maxTotalDurationMs': '전체 파이프라인 최대 허용 실행 시간',
  'safety.maxFileChanges': '한 번에 변경 가능한 최대 파일 수',
  'safety.maxInsertions': '한 번에 허용되는 최대 줄 추가 수',
  'safety.maxDeletions': '한 번에 허용되는 최대 줄 삭제 수',
  'safety.requireTests': '활성화 시 테스트 없는 PR 차단',
  'safety.blockDirectBasePush': '베이스 브랜치 직접 푸시 차단',
  'safety.strict': '엄격 모드 — 모든 안전 규칙을 필수로 적용',
  'safety.rollbackStrategy': '실패 시 롤백 전략 (none, all, failed-only)',
  'review.enabled': '코드 리뷰 단계 활성화 여부',
  'review.unifiedMode': '활성화 시 1회 호출로 3가지 관점 통합 평가',
};

/**
 * camelCase 키를 Title Case 문자열로 변환
 * @param {string} str
 * @returns {string}
 */
function camelToTitle(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, function(s) { return s.toUpperCase(); }).trim();
}

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
  var displayLabel = FIELD_DISPLAY_LABELS[configPath] || camelToTitle(key);
  var description = FIELD_DESCRIPTIONS[configPath] || '';

  var html = '<label class="block">';
  html += '<span class="text-[10px] font-black uppercase text-primary tracking-widest block mb-1">' + esc(displayLabel) + '</span>';
  if (description) {
    html += '<span class="text-[10px] text-outline block mb-2">' + esc(description) + '</span>';
  } else {
    html += '<span class="block mb-2"></span>';
  }

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
 * config.commands.claudeCli 값을 maxTurns / maxTurnsPerMode 필드에 바인딩
 * @param {AqmConfig} config
 * @returns {void}
 */
function bindCommandsCliFields(config) {
  var commands = /** @type {any} */ (config).commands;
  var cli = commands && commands.claudeCli ? commands.claudeCli : null;
  if (!cli) return;

  var maxTurnsEl = document.getElementById('field-commands-claudeCli-maxTurns');
  if (maxTurnsEl && typeof cli.maxTurns === 'number') {
    /** @type {HTMLInputElement} */ (maxTurnsEl).value = String(cli.maxTurns);
  }

  var modes = ['economy', 'standard', 'thorough'];
  modes.forEach(function(mode) {
    var el = document.getElementById('field-commands-claudeCli-maxTurnsPerMode-' + mode);
    if (el && cli.maxTurnsPerMode && typeof cli.maxTurnsPerMode[mode] === 'number') {
      /** @type {HTMLInputElement} */ (el).value = String(cli.maxTurnsPerMode[mode]);
    }
  });
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

/* ══════════════════════════════════════════════════════════════
   Basic Tab Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * Basic 탭 렌더링: /api/config/schema-meta에서 메타데이터를 fetch하고 필드를 렌더링한다.
 * @param {AqmConfig} config
 * @returns {void}
 */
function renderBasicTab(config) {
  var container = document.getElementById('basic-settings-form');
  if (!container) return;
  container.innerHTML = '<div class="col-span-full flex items-center justify-center py-12 text-outline text-sm gap-2">' +
    '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span>' +
    '<span>로딩 중...</span></div>';

  apiFetch('/api/config/schema-meta')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      /**
       * @type {Array<{key: string, type: string, label: string, helperText?: string, default?: *, min?: number, max?: number, options?: string[]}>}
       */
      var fields = data.fields || [];
      if (fields.length === 0) {
        /** @type {HTMLElement} */ (container).innerHTML = '<div class="col-span-full text-outline text-sm text-center py-8">표시할 필드가 없습니다.</div>';
        return;
      }
      var html = '';
      fields.forEach(function(meta) {
        var value = getConfigValueByPath(/** @type {Record<string, *>} */ (config), meta.key);
        html += renderBasicField(meta, value);
      });
      /** @type {HTMLElement} */ (container).innerHTML = html;
      loadPresetsDropdown();
    })
    .catch(function() {
      /** @type {HTMLElement} */ (container).innerHTML = '<div class="col-span-full flex items-center justify-center py-12 text-outline text-sm gap-2">' +
        '<span class="material-symbols-outlined text-base">error</span>' +
        '<span>메타데이터를 불러올 수 없습니다.</span></div>';
    });
}

/**
 * dotted path로 config 객체에서 값을 추출한다. (예: "general.concurrency" → config.general.concurrency)
 * @param {Record<string, *>} config
 * @param {string} path
 * @returns {*}
 */
function getConfigValueByPath(config, path) {
  var parts = path.split('.');
  var current = /** @type {*} */ (config);
  for (var i = 0; i < parts.length; i++) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[parts[i]];
  }
  return current;
}

/**
 * @param {{key: string, type: string, label: string, helperText?: string, default?: *, min?: number, max?: number, options?: string[]}} meta
 * @param {*} value
 * @returns {string}
 */
function renderBasicField(meta, value) {
  var fieldId = 'basic-field-' + meta.key.replace(/\./g, '-');
  var displayValue = (value !== undefined && value !== null) ? value : meta.default;

  var html = '<div class="space-y-1">';

  // Label + 배지 행
  html += '<div id="' + fieldId + '-badges" class="flex items-center gap-2 flex-wrap">';
  html += '<span class="text-[10px] font-black uppercase text-primary tracking-widest">' + esc(meta.label) + '</span>';
  if (meta.default !== undefined && meta.default !== null) {
    html += '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-mono">기본: ' + esc(String(meta.default)) + '</span>';
  }
  if (typeof meta.min === 'number') {
    html += '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-outline/10 text-outline font-mono">min: ' + meta.min + '</span>';
  }
  if (typeof meta.max === 'number') {
    html += '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-outline/10 text-outline font-mono">max: ' + meta.max + '</span>';
  }
  html += '</div>';

  // Helper text
  if (meta.helperText) {
    html += '<span class="text-[10px] text-outline block mb-1">' + esc(meta.helperText) + '</span>';
  }

  // type별 컨트롤 렌더링
  switch (meta.type) {
    case 'number':
      html += renderBasicNumberControl(fieldId, meta.key, displayValue, meta.min, meta.max);
      break;
    case 'toggle':
      html += renderBasicToggleControl(fieldId, meta.key, Boolean(displayValue));
      break;
    case 'dropdown':
      html += renderBasicDropdownControl(fieldId, meta.key, String(displayValue !== undefined ? displayValue : ''), meta.options || []);
      break;
    case 'chip-input':
      html += renderBasicChipInputControl(fieldId, meta.key, Array.isArray(displayValue) ? displayValue : []);
      break;
    default: // text
      html += renderBasicTextControl(fieldId, meta.key, String(displayValue !== undefined ? displayValue : ''));
  }

  html += '</div>';
  return html;
}

/**
 * @param {string} fieldId
 * @param {string} configPath
 * @param {*} value
 * @param {number|undefined} min
 * @param {number|undefined} max
 * @returns {string}
 */
function renderBasicNumberControl(fieldId, configPath, value, min, max) {
  var numVal = typeof value === 'number' ? value : (parseInt(String(value), 10) || 0);
  var attrs = 'type="number" id="' + fieldId + '" data-config-path="' + esc(configPath) + '" value="' + numVal + '"';
  if (typeof min === 'number') attrs += ' min="' + min + '"';
  if (typeof max === 'number') attrs += ' max="' + max + '"';
  return '<input ' + attrs + ' class="w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none" />';
}

/**
 * @param {string} fieldId
 * @param {string} configPath
 * @param {boolean} checked
 * @returns {string}
 */
function renderBasicToggleControl(fieldId, configPath, checked) {
  return '<div class="flex items-center justify-between p-3 bg-surface-container-low rounded-lg">' +
         '<span class="text-sm font-bold">' + (checked ? (t('enabled') || 'Enabled') : (t('disabled') || 'Disabled')) + '</span>' +
         '<label class="relative inline-flex items-center cursor-pointer">' +
         '<input type="checkbox" id="' + fieldId + '" data-config-path="' + esc(configPath) + '" ' + (checked ? 'checked' : '') + ' class="sr-only peer" />' +
         '<div class="w-11 h-6 bg-outline-variant/40 rounded-full peer peer-checked:bg-primary peer-checked:after:translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>' +
         '</label>' +
         '</div>';
}

/**
 * @param {string} fieldId
 * @param {string} configPath
 * @param {string} value
 * @param {string[]} options
 * @returns {string}
 */
function renderBasicDropdownControl(fieldId, configPath, value, options) {
  var html = '<select id="' + fieldId + '" data-config-path="' + esc(configPath) + '" ' +
             'class="w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none">';
  options.forEach(function(opt) {
    html += '<option value="' + esc(opt) + '"' + (opt === value ? ' selected' : '') + '>' + esc(opt) + '</option>';
  });
  html += '</select>';
  return html;
}

/**
 * @param {string} fieldId
 * @param {string} configPath
 * @param {string[]} values
 * @returns {string}
 */
function renderBasicChipInputControl(fieldId, configPath, values) {
  var chipsHtml = '';
  values.forEach(function(val, idx) {
    chipsHtml += '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">' +
                 esc(val) +
                 '<button type="button" onclick="removeBasicChip(\'' + fieldId + '\',' + idx + ')" ' +
                 'class="hover:text-error transition-colors"><span class="material-symbols-outlined text-[12px]">close</span></button>' +
                 '</span>';
  });

  return '<div id="' + fieldId + '-chips" class="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">' + chipsHtml + '</div>' +
         '<input type="hidden" id="' + fieldId + '" data-config-path="' + esc(configPath) + '" data-input-type="chip-array" value="' + esc(JSON.stringify(values)) + '" />' +
         '<div class="flex gap-1">' +
         '<input type="text" id="' + fieldId + '-input" placeholder="값 입력 후 Enter" ' +
         'class="flex-1 bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-2 px-3 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none" ' +
         'onkeydown="addBasicChipOnEnter(event,\'' + fieldId + '\')" />' +
         '<button type="button" onclick="addBasicChip(\'' + fieldId + '\')" ' +
         'class="px-2 py-1 text-primary hover:bg-primary/10 rounded transition-colors">' +
         '<span class="material-symbols-outlined text-sm">add</span></button>' +
         '</div>';
}

/**
 * @param {string} fieldId
 * @param {string} configPath
 * @param {string} value
 * @returns {string}
 */
function renderBasicTextControl(fieldId, configPath, value) {
  return '<input type="text" id="' + fieldId + '" data-config-path="' + esc(configPath) + '" value="' + esc(value) + '" ' +
         'class="w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none" />';
}

/**
 * chip-input: Enter 키로 항목 추가
 * @param {KeyboardEvent} event
 * @param {string} fieldId
 * @returns {void}
 */
function addBasicChipOnEnter(event, fieldId) {
  if (event.key === 'Enter') {
    event.preventDefault();
    addBasicChip(fieldId);
  }
}

/**
 * chip-input: 항목 추가
 * @param {string} fieldId
 * @returns {void}
 */
function addBasicChip(fieldId) {
  var textInput = /** @type {HTMLInputElement|null} */ (document.getElementById(fieldId + '-input'));
  var hiddenInput = /** @type {HTMLInputElement|null} */ (document.getElementById(fieldId));
  if (!textInput || !hiddenInput) return;
  var val = textInput.value.trim();
  if (!val) return;
  var current = /** @type {string[]} */ ([]);
  try { current = JSON.parse(hiddenInput.value); } catch (e) { current = []; }
  if (current.indexOf(val) !== -1) { textInput.value = ''; return; }
  current.push(val);
  hiddenInput.value = JSON.stringify(current);
  textInput.value = '';
  _refreshChipsDisplay(fieldId, current);
}

/**
 * chip-input: 항목 삭제
 * @param {string} fieldId
 * @param {number} idx
 * @returns {void}
 */
function removeBasicChip(fieldId, idx) {
  var hiddenInput = /** @type {HTMLInputElement|null} */ (document.getElementById(fieldId));
  if (!hiddenInput) return;
  var current = /** @type {string[]} */ ([]);
  try { current = JSON.parse(hiddenInput.value); } catch (e) { current = []; }
  current.splice(idx, 1);
  hiddenInput.value = JSON.stringify(current);
  _refreshChipsDisplay(fieldId, current);
}

/* ══════════════════════════════════════════════════════════════
   Advanced Tab JSON Cards Rendering
   ══════════════════════════════════════════════════════════════ */

/**
 * Advanced 탭의 5개 JSON 섹션을 collapsible 카드로 렌더링한다.
 * 섹션: hooks, retryPolicy, models, allowedTools, sensitivePaths
 * @param {AqmConfig} config
 * @returns {void}
 */
function renderAdvancedTab(config) {
  var container = document.getElementById('advanced-json-cards-list');
  if (!container) return;

  var anyConfig = /** @type {any} */ (config);

  /** @type {Array<{id: string, label: string, value: *, configPath: string}>} */
  var sections = [
    {
      id: 'hooks',
      label: 'hooks',
      value: anyConfig.hooks,
      configPath: 'hooks',
    },
    {
      id: 'retryPolicy',
      label: 'retryPolicy',
      value: anyConfig.commands && anyConfig.commands.claudeCli ? anyConfig.commands.claudeCli.retry : undefined,
      configPath: 'commands.claudeCli.retry',
    },
    {
      id: 'models',
      label: 'models',
      value: anyConfig.commands && anyConfig.commands.claudeCli ? anyConfig.commands.claudeCli.models : undefined,
      configPath: 'commands.claudeCli.models',
    },
    {
      id: 'allowedTools',
      label: 'allowedTools',
      value: anyConfig.allowedTools,
      configPath: 'allowedTools',
    },
    {
      id: 'sensitivePaths',
      label: 'sensitivePaths',
      value: anyConfig.safety ? anyConfig.safety.sensitivePaths : undefined,
      configPath: 'safety.sensitivePaths',
    },
  ];

  var html = '';
  sections.forEach(function(section) {
    html += renderAdvancedJsonCard(section.id, section.label, section.value, section.configPath);
  });
  container.innerHTML = html;
}

/**
 * @param {string} sectionId
 * @param {string} label
 * @param {*} value
 * @param {string} configPath
 * @returns {string}
 */
function renderAdvancedJsonCard(sectionId, label, value, configPath) {
  var jsonText = value !== undefined && value !== null
    ? JSON.stringify(value, null, 2)
    : 'null';
  var fieldId = 'advanced-json-' + sectionId;
  var bodyId = 'advanced-card-body-' + sectionId;
  var iconId = 'advanced-card-icon-' + sectionId;

  var html = '<div class="bg-surface-container-lowest border border-outline-variant/20 rounded-sm overflow-hidden">';

  // 카드 헤더 (접힌 상태)
  html += '<button type="button" ' +
          'class="w-full p-4 flex items-center justify-between hover:bg-surface-container-low transition-colors" ' +
          'onclick="toggleAdvancedCard(\'' + sectionId + '\')">';
  html += '<span class="font-mono text-sm text-on-surface">' + esc(label) + '</span>';
  html += '<span class="material-symbols-outlined text-outline transition-transform" id="' + iconId + '">expand_more</span>';
  html += '</button>';

  // 카드 본문 (펼쳐진 상태, 기본 숨김)
  html += '<div id="' + bodyId + '" class="hidden px-4 pb-4">';
  html += '<textarea id="' + fieldId + '" ' +
          'data-config-path="' + esc(configPath) + '" ' +
          'rows="8" ' +
          'class="w-full bg-surface-container-highest/40 border-0 border-b-2 border-outline-variant/30 py-3 px-4 text-sm text-on-surface focus:border-primary transition-colors rounded-t outline-none font-mono">' +
          esc(jsonText) +
          '</textarea>';
  html += '<div id="' + fieldId + '-error" class="hidden mt-1 text-xs text-[#f85149] font-mono"></div>';
  html += '<button type="button" ' +
          'class="mt-3 flex items-center gap-2 text-xs font-bold text-primary-container hover:text-primary transition-colors" ' +
          'onclick="copyAdvancedConfigPath(\'' + esc(configPath) + '\')">';
  html += '<span class="material-symbols-outlined text-sm">code</span>';
  html += '<span>config.yml 경로 복사</span>';
  html += '</button>';
  html += '</div>';

  html += '</div>';
  return html;
}

/**
 * Advanced JSON 카드를 토글한다 (접기/펼치기).
 * @param {string} sectionId
 * @returns {void}
 */
function toggleAdvancedCard(sectionId) {
  var body = document.getElementById('advanced-card-body-' + sectionId);
  var icon = document.getElementById('advanced-card-icon-' + sectionId);
  if (!body || !icon) return;

  var isHidden = body.classList.contains('hidden');
  if (isHidden) {
    body.classList.remove('hidden');
    icon.style.transform = 'rotate(180deg)';
  } else {
    body.classList.add('hidden');
    icon.style.transform = '';
  }
}

/**
 * config.yml 키 경로를 클립보드에 복사한다.
 * @param {string} configPath
 * @returns {void}
 */
function copyAdvancedConfigPath(configPath) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(configPath).then(function() {
      // 복사 성공 — 별도 토스트 없음
    }).catch(function() {
      // 조용히 실패
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   Preset Dropdown + Diff Popover
   ══════════════════════════════════════════════════════════════ */

/**
 * @typedef {{ name: string, label: string, description: string, fields: Record<string, unknown> }} ConfigPreset
 */

/** @type {ConfigPreset[]} */
var _loadedPresets = [];

/**
 * 필드별 칩 상태: configPath → 'custom' | preset 이름
 * @type {Record<string, string>}
 */
var _presetFieldState = {};

/**
 * /api/config/presets를 fetch하여 드롭다운 옵션을 채운다.
 * renderBasicTab 완료 후 호출한다.
 * @returns {void}
 */
function loadPresetsDropdown() {
  apiFetch('/api/config/presets')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _loadedPresets = data.presets || [];
      var select = /** @type {HTMLSelectElement|null} */ (document.getElementById('preset-select'));
      if (!select) return;
      // 첫 번째 placeholder 옵션은 유지
      while (select.options.length > 1) {
        select.remove(1);
      }
      var selectEl = select;
      _loadedPresets.forEach(function(preset) {
        var opt = document.createElement('option');
        opt.value = preset.name;
        opt.textContent = preset.label + ' — ' + preset.description;
        selectEl.appendChild(opt);
      });
    })
    .catch(function() {
      // 프리셋 로드 실패 시 드롭다운 비활성화
      var select = /** @type {HTMLSelectElement|null} */ (document.getElementById('preset-select'));
      if (select) select.disabled = true;
    });
}

/**
 * Basic 탭 현재 폼 필드 값을 {configPath: value} 맵으로 수집한다.
 * @returns {Record<string, unknown>}
 */
function collectBasicFieldValues() {
  var result = /** @type {Record<string, unknown>} */ ({});
  var form = document.getElementById('basic-settings-form');
  if (!form) return result;

  var inputs = form.querySelectorAll('[data-config-path]');
  inputs.forEach(function(el) {
    var path = el.getAttribute('data-config-path');
    if (!path) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        result[path] = el.checked;
      } else if (el.type === 'number') {
        result[path] = el.value !== '' ? Number(el.value) : undefined;
      } else if (el.dataset.inputType === 'chip-array') {
        try { result[path] = JSON.parse(el.value); } catch (e) { result[path] = []; }
      } else {
        result[path] = el.value;
      }
    } else if (el instanceof HTMLSelectElement) {
      result[path] = el.value;
    } else if (el instanceof HTMLTextAreaElement) {
      result[path] = el.value;
    }
  });
  return result;
}

/**
 * 선택된 프리셋과 현재 폼 값의 diff를 계산하여 popover를 표시한다.
 * @returns {void}
 */
function previewPreset() {
  var select = /** @type {HTMLSelectElement|null} */ (document.getElementById('preset-select'));
  if (!select || !select.value) return;

  var previewPresetName = select.value;
  var preset = _loadedPresets.find(function(p) { return p.name === previewPresetName; });
  if (!preset) return;

  var current = collectBasicFieldValues();
  var diffRows = /** @type {Array<{key: string, before: string, after: string}>} */ ([]);
  var previewFields = preset.fields;

  Object.keys(previewFields).forEach(function(key) {
    var beforeRaw = current[key];
    var afterRaw = previewFields[key];
    var before = beforeRaw !== undefined ? String(beforeRaw) : '(없음)';
    var after = afterRaw !== undefined ? String(afterRaw) : '(없음)';
    if (before !== after) {
      diffRows.push({ key: key, before: before, after: after });
    }
  });

  var contentEl = document.getElementById('preset-diff-content');
  var popover = document.getElementById('preset-diff-popover');
  if (!contentEl || !popover) return;

  if (diffRows.length === 0) {
    contentEl.innerHTML =
      '<div class="flex items-center gap-2 text-sm text-outline py-2">' +
      '<span class="material-symbols-outlined text-base">check_circle</span>' +
      '변경 없음 — 현재 설정과 동일합니다.</div>';
  } else {
    var html = '<div class="overflow-x-auto">';
    html += '<table class="w-full text-xs border-collapse">';
    html += '<thead><tr class="text-[10px] uppercase text-outline tracking-widest">';
    html += '<th class="text-left py-1 pr-4 font-bold">필드</th>';
    html += '<th class="text-left py-1 pr-4 font-bold text-error/80">현재값</th>';
    html += '<th class="text-left py-1 font-bold text-primary/80">변경 후</th>';
    html += '</tr></thead><tbody>';
    diffRows.forEach(function(row) {
      html += '<tr class="border-t border-outline-variant/20">';
      html += '<td class="py-1.5 pr-4 font-mono text-on-surface-variant">' + esc(row.key) + '</td>';
      html += '<td class="py-1.5 pr-4 font-mono text-error/80 line-through">' + esc(row.before) + '</td>';
      html += '<td class="py-1.5 font-mono text-primary font-bold">' + esc(row.after) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    contentEl.innerHTML = html;
  }

  popover.classList.remove('hidden');
}

/**
 * diff popover를 닫는다.
 * @returns {void}
 */
function closeDiffPopover() {
  var popover = document.getElementById('preset-diff-popover');
  if (popover) popover.classList.add('hidden');
}

/**
 * 특정 필드 옆에 preset/custom 칩 배지를 표시하거나 갱신한다.
 * @param {string} configPath
 * @param {string} chipLabel  'custom' 또는 preset 이름
 * @returns {void}
 */
function _setFieldPresetChip(configPath, chipLabel) {
  var fieldId = 'basic-field-' + configPath.replace(/\./g, '-');
  var badgesEl = document.getElementById(fieldId + '-badges');
  if (!badgesEl) return;

  var existingChip = document.getElementById(fieldId + '-preset-chip');
  if (existingChip) existingChip.remove();

  var chip = document.createElement('span');
  chip.id = fieldId + '-preset-chip';
  if (chipLabel === 'custom') {
    chip.className = 'text-[9px] px-1.5 py-0.5 rounded-full bg-outline/10 text-outline font-mono';
    chip.textContent = 'custom';
  } else {
    chip.className = 'text-[9px] px-1.5 py-0.5 rounded-full bg-tertiary/10 text-tertiary font-mono';
    chip.textContent = 'preset: ' + chipLabel;
  }
  badgesEl.appendChild(chip);
}

/**
 * 모든 필드의 preset 칩을 제거하고 상태를 초기화한다.
 * @returns {void}
 */
function _clearAllFieldPresetChips() {
  Object.keys(_presetFieldState).forEach(function(configPath) {
    var fieldId = 'basic-field-' + configPath.replace(/\./g, '-');
    var chip = document.getElementById(fieldId + '-preset-chip');
    if (chip) chip.remove();
  });
  _presetFieldState = {};
}

/**
 * 선택된 프리셋의 fields를 Basic 탭 폼 필드에 적용한다.
 * 적용 후 active chip을 표시하고, 이후 필드 변경 시 custom 칩으로 전환한다.
 * @returns {void}
 */
function applyPreset() {
  var select = /** @type {HTMLSelectElement|null} */ (document.getElementById('preset-select'));
  if (!select || !select.value) return;

  var applyPresetName = select.value;
  var preset = _loadedPresets.find(function(p) { return p.name === applyPresetName; });
  if (!preset) return;

  var form = document.getElementById('basic-settings-form');
  if (!form) return;

  _clearAllFieldPresetChips();
  var currentValues = collectBasicFieldValues();
  var applyFields = preset.fields;
  var appliedName = preset.name;
  var formEl = form;

  Object.keys(applyFields).forEach(function(key) {
    var el = formEl.querySelector('[data-config-path="' + key + '"]');
    if (!el) return;
    var val = applyFields[key];

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        el.checked = Boolean(val);
      } else if (el.type === 'number') {
        el.value = String(typeof val === 'number' ? val : Number(val));
      } else {
        el.value = String(val !== null && val !== undefined ? val : '');
      }
    } else if (el instanceof HTMLSelectElement) {
      el.value = String(val !== null && val !== undefined ? val : '');
    } else if (el instanceof HTMLTextAreaElement) {
      el.value = String(val !== null && val !== undefined ? val : '');
    }

    var before = currentValues[key] !== undefined ? String(currentValues[key]) : '(없음)';
    var after = val !== undefined ? String(val) : '(없음)';
    if (before !== after) {
      _presetFieldState[key] = appliedName;
      _setFieldPresetChip(key, appliedName);
      el.addEventListener('change', function onPresetFieldChange() {
        _presetFieldState[key] = 'custom';
        _setFieldPresetChip(key, 'custom');
      }, { once: true });
    }
  });

  closeDiffPopover();
  _showPresetChip(preset.label);
  _attachBasicFieldChangeListeners();
}

/**
 * active preset 칩을 표시한다.
 * @param {string} label
 * @returns {void}
 */
function _showPresetChip(label) {
  var chip = document.getElementById('preset-active-chip');
  var chipLabel = document.getElementById('preset-active-chip-label');
  if (chip && chipLabel) {
    chipLabel.textContent = label;
    chip.classList.remove('hidden');
    chip.classList.add('inline-flex');
  }
}

/**
 * 프리셋 적용 후 Basic 필드가 변경되면 chip을 'custom'으로 전환한다.
 * @returns {void}
 */
function _attachBasicFieldChangeListeners() {
  var form = document.getElementById('basic-settings-form');
  if (!form) return;
  var inputs = form.querySelectorAll('[data-config-path]');
  inputs.forEach(function(el) {
    el.addEventListener('change', function onFieldChange() {
      _showPresetChip('custom');
      el.removeEventListener('change', onFieldChange);
    }, { once: true });
  });
}

/**
 * chip-input: 칩 목록 UI 갱신
 * @param {string} fieldId
 * @param {string[]} values
 * @returns {void}
 */
function _refreshChipsDisplay(fieldId, values) {
  var chipsContainer = document.getElementById(fieldId + '-chips');
  if (!chipsContainer) return;
  var html = '';
  values.forEach(function(val, idx) {
    html += '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">' +
            esc(val) +
            '<button type="button" onclick="removeBasicChip(\'' + fieldId + '\',' + idx + ')" ' +
            'class="hover:text-error transition-colors"><span class="material-symbols-outlined text-[12px]">close</span></button>' +
            '</span>';
  });
  chipsContainer.innerHTML = html;
}
