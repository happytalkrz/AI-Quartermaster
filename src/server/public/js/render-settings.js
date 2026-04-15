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

  // 저장된 탭 선택 복원 또는 기본 탭 설정
  var savedTab = localStorage.getItem('aqm-selected-tab') || 'general';
  setSettingsTab(savedTab);

  // 프리셋 드롭다운 초기화
  initPresetDropdown();
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
   Preset Logic
   ══════════════════════════════════════════════════════════════ */

/** @type {Record<string, string>} */
var PRESET_DESCRIPTIONS = {
  economy:  '빠른 구현에 집중. 리뷰 스킵으로 토큰 소비 최소화',
  standard: '균형 잡힌 품질과 효율성. 1라운드 리뷰로 기본적인 품질 보장',
  thorough: '최고 수준의 코드 품질 보장. 보안 및 아키텍처 변경에 적합',
  team:     '팀 운영에 최적화. 병렬 처리로 여러 이슈를 동시에 처리',
  solo:     '개인 개발자에 최적화. 단일 작업에 집중하며 빠른 피드백 루프',
};

/**
 * Basic 탭 대상 프리셋 값 (src/config/presets.ts의 JS 미러)
 * @type {Record<string, {maxConcurrentJobs:number, reviewEnabled:boolean, reviewRounds:number, reviewUnifiedMode:boolean, simplifyEnabled:boolean, executionMode:string, claudeTimeout:number}>}
 */
var PRESET_DATA = {
  economy:  { maxConcurrentJobs: 1, reviewEnabled: false, reviewRounds: 0, reviewUnifiedMode: false, simplifyEnabled: false, executionMode: 'economy',  claudeTimeout: 300000 },
  standard: { maxConcurrentJobs: 1, reviewEnabled: true,  reviewRounds: 1, reviewUnifiedMode: false, simplifyEnabled: true,  executionMode: 'standard', claudeTimeout: 600000 },
  thorough: { maxConcurrentJobs: 1, reviewEnabled: true,  reviewRounds: 3, reviewUnifiedMode: true,  simplifyEnabled: true,  executionMode: 'thorough', claudeTimeout: 900000 },
  team:     { maxConcurrentJobs: 3, reviewEnabled: true,  reviewRounds: 1, reviewUnifiedMode: false, simplifyEnabled: true,  executionMode: 'standard', claudeTimeout: 600000 },
  solo:     { maxConcurrentJobs: 1, reviewEnabled: true,  reviewRounds: 1, reviewUnifiedMode: false, simplifyEnabled: false, executionMode: 'economy',  claudeTimeout: 300000 },
};

/** @type {Record<string, string>} */
var PRESET_FIELD_LABELS = {
  maxConcurrentJobs: '동시 작업 수',
  reviewEnabled:     '리뷰 활성화',
  reviewRounds:      '리뷰 라운드',
  reviewUnifiedMode: '통합 리뷰 모드',
  simplifyEnabled:   '코드 간소화',
  executionMode:     '실행 모드',
  claudeTimeout:     'Claude 타임아웃(ms)',
};

/** @type {Record<string, string>} config PATCH 경로 매핑 (Basic 탭 대상 필드만) */
var PRESET_FIELD_CONFIG_PATHS = {
  maxConcurrentJobs: 'general.concurrency',
  reviewEnabled:     'review.enabled',
  reviewUnifiedMode: 'review.unifiedMode',
  simplifyEnabled:   'review.simplify.enabled',
  executionMode:     'executionMode',
  claudeTimeout:     'commands.claudeCli.timeout',
};

/** @type {string|null} */
var currentPresetName = null;

/** @type {Array<{field:string, label:string, currentValue:*, presetValue:*}>} */
var currentPresetDiff = [];

/**
 * AQConfig 객체에서 프리셋 비교 대상 필드를 추출한다.
 * @param {*} config
 * @returns {Record<string, *>}
 */
function extractPresetFieldsFromConfig(config) {
  return {
    maxConcurrentJobs: config.general ? config.general.concurrency : undefined,
    reviewEnabled:     config.review  ? config.review.enabled      : undefined,
    reviewRounds:      (config.review && Array.isArray(config.review.rounds)) ? config.review.rounds.length : undefined,
    reviewUnifiedMode: config.review  ? (config.review.unifiedMode || false) : undefined,
    simplifyEnabled:   (config.review && config.review.simplify) ? config.review.simplify.enabled : undefined,
    executionMode:     config.executionMode,
    claudeTimeout:     (config.commands && config.commands.claudeCli) ? config.commands.claudeCli.timeout : undefined,
  };
}

/**
 * 현재 config 대비 프리셋 diff를 계산한다.
 * @param {*} config
 * @param {string} presetName
 * @returns {Array<{field:string, label:string, currentValue:*, presetValue:*}>}
 */
function computePresetDiffJs(config, presetName) {
  var preset = PRESET_DATA[presetName];
  if (!preset) return [];
  var current = extractPresetFieldsFromConfig(config);
  /** @type {Array<{field:string, label:string, currentValue:unknown, presetValue:unknown}>} */
  var diff = [];
  var currentRecord = /** @type {Record<string, unknown>} */ (current);
  var presetRecord  = /** @type {Record<string, unknown>} */ (preset);
  var fields = Object.keys(PRESET_FIELD_LABELS);
  fields.forEach(function(field) {
    var currentVal = currentRecord[field];
    var presetVal  = presetRecord[field];
    if (currentVal !== undefined && currentVal !== presetVal) {
      diff.push({ field: field, label: PRESET_FIELD_LABELS[field], currentValue: currentVal, presetValue: presetVal });
    }
  });
  return diff;
}

/**
 * @param {*} val
 * @returns {string}
 */
function formatPresetValue(val) {
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

/**
 * diff 배열을 HTML로 렌더링한다.
 * @param {Array<{field:string, label:string, currentValue:*, presetValue:*}>} diff
 * @returns {string}
 */
function renderPresetDiffContent(diff) {
  if (diff.length === 0) {
    return '<div class="text-outline text-center py-2">변경사항 없음 — 현재 설정이 이미 이 프리셋과 동일합니다.</div>';
  }
  var html = '';
  diff.forEach(function(entry) {
    html += '<div class="flex justify-between items-center gap-2">';
    html += '<span class="text-outline truncate flex-shrink-0">' + esc(entry.label) + '</span>';
    html += '<div class="flex items-center gap-1.5 flex-shrink-0">';
    html += '<span class="text-error line-through">' + esc(formatPresetValue(entry.currentValue)) + '</span>';
    html += '<span class="material-symbols-outlined text-[10px] text-outline">arrow_forward</span>';
    html += '<span class="text-primary">' + esc(formatPresetValue(entry.presetValue)) + '</span>';
    html += '</div>';
    html += '</div>';
  });
  return html;
}

/** @returns {void} */
function togglePresetDiffPopover() {
  var popover = document.getElementById('preset-diff-popover');
  if (popover) popover.classList.toggle('hidden');
}

/** @returns {void} */
function closePresetDiffPopover() {
  var popover = document.getElementById('preset-diff-popover');
  if (popover) popover.classList.add('hidden');
}

/** @returns {void} */
function applyPreset() {
  if (!currentPresetName || !currentPresetDiff) {
    closePresetDiffPopover();
    return;
  }

  /** @type {Record<string, *>} */
  var patches = {};
  currentPresetDiff.forEach(function(entry) {
    var configPath = PRESET_FIELD_CONFIG_PATHS[entry.field];
    if (configPath) {
      patches[configPath] = entry.presetValue;
    }
  });

  // reviewRounds는 PATCH 경로가 없으므로 별도 처리 없음 (서버측 프리셋 적용 시 처리)
  fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patches),
  })
  .then(function(res) {
    if (!res.ok) throw new Error('PATCH failed: ' + res.status);
    return res.json();
  })
  .then(function() {
    closePresetDiffPopover();
    var presetName = currentPresetName || '';
    // 적용된 필드에 preset 칩 렌더
    currentPresetDiff.forEach(function(entry) {
      var configPath = PRESET_FIELD_CONFIG_PATHS[entry.field];
      if (configPath) renderPresetChipForField(configPath, presetName);
    });
    // 이후 개별 수정 시 custom 칩으로 변경
    bindPresetFieldChangeListeners();
    // 피드백 표시
    var descEl = document.getElementById('preset-desc');
    if (descEl) {
      descEl.textContent = '✓ ' + presetName + ' 프리셋 적용됨';
      descEl.className = 'text-xs text-primary italic';
    }
  })
  .catch(function(err) {
    console.error('[AQM] preset apply failed:', err);
  });
}

/**
 * 필드 라벨 옆에 preset 칩을 렌더링한다.
 * @param {string} configPath  e.g. "general.concurrency"
 * @param {string} presetName
 * @returns {void}
 */
function renderPresetChipForField(configPath, presetName) {
  var fieldId = 'field-' + configPath.replace(/\./g, '-');
  var el = document.getElementById(fieldId);
  if (!el) return;
  var label = el.closest('label');
  if (!label) return;

  // 기존 칩 제거
  var existing = label.querySelector('.aqm-preset-chip');
  if (existing) existing.remove();

  var chip = document.createElement('span');
  chip.className = 'aqm-preset-chip px-1.5 py-0.5 text-[9px] bg-primary/10 text-primary rounded-sm font-mono border border-primary/20 ml-1 align-middle';
  chip.dataset.configPath = configPath;
  chip.textContent = 'PRESET:' + presetName.toUpperCase();

  var labelText = label.querySelector('span.text-\\[10px\\]');
  if (labelText) {
    labelText.appendChild(chip);
  } else {
    // fallback: 라벨 첫 span에 붙이기
    var firstSpan = label.querySelector('span');
    if (firstSpan) firstSpan.appendChild(chip);
  }
}

/**
 * 적용된 필드의 change 이벤트를 바인딩하여 수정 시 CUSTOM 칩으로 교체한다.
 * @returns {void}
 */
function bindPresetFieldChangeListeners() {
  currentPresetDiff.forEach(function(entry) {
    var configPath = PRESET_FIELD_CONFIG_PATHS[entry.field];
    if (!configPath) return;
    var fieldId = 'field-' + configPath.replace(/\./g, '-');
    var el = document.getElementById(fieldId);
    if (!el) return;
    var boundEl = /** @type {HTMLElement} */ (el);

    /** @type {EventListener} */
    var handler = function onFieldChange() {
      var label = boundEl.closest('label');
      if (!label) return;
      var chip = label.querySelector('.aqm-preset-chip');
      if (chip) {
        chip.className = 'aqm-preset-chip px-1.5 py-0.5 text-[9px] bg-tertiary/10 text-tertiary rounded-sm font-mono border border-tertiary/20 ml-1 align-middle';
        chip.textContent = 'CUSTOM';
      }
      boundEl.removeEventListener('change', handler);
    };
    boundEl.addEventListener('change', handler);
  });
}

/**
 * 프리셋 드롭다운 이벤트를 초기화한다. renderSettingsView에서 호출된다.
 * @returns {void}
 */
function initPresetDropdown() {
  var select = document.getElementById('preset-select');
  if (!select) return;

  // 중복 바인딩 방지
  select.removeEventListener('change', onPresetSelectChange);
  select.addEventListener('change', onPresetSelectChange);
}

/** @returns {void} */
function onPresetSelectChange() {
  var select = /** @type {HTMLSelectElement} */ (document.getElementById('preset-select'));
  if (!select) return;
  var presetName = select.value;
  var descEl     = document.getElementById('preset-desc');
  var wrapper    = document.getElementById('preset-diff-wrapper');

  if (!presetName) {
    if (wrapper) wrapper.style.display = 'none';
    if (descEl)  { descEl.textContent = ''; descEl.className = 'text-xs text-outline italic'; }
    currentPresetName = null;
    currentPresetDiff = [];
    return;
  }

  currentPresetName = presetName;
  if (descEl) {
    descEl.textContent = PRESET_DESCRIPTIONS[presetName] || '';
    descEl.className   = 'text-xs text-outline italic';
  }

  // 현재 config fetch → diff 계산
  fetch('/api/config')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var config = data.config || data;
      currentPresetDiff = computePresetDiffJs(config, presetName);

      var titleEl   = document.getElementById('preset-diff-title');
      var contentEl = document.getElementById('preset-diff-content');
      if (titleEl)   titleEl.textContent  = 'PRESET DIFF: ' + presetName.toUpperCase();
      if (contentEl) contentEl.innerHTML  = renderPresetDiffContent(currentPresetDiff);

      if (wrapper) wrapper.style.display = '';
    })
    .catch(function(err) {
      console.error('[AQM] preset config fetch failed:', err);
    });
}
