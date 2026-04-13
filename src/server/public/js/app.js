// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════════════════════ */
/** @type {string} */
var currentView = 'dashboard';

/**
 * @param {string} view
 * @returns {void}
 */
function navigateTo(view) {
  currentView = view;
  // Update view panels
  document.querySelectorAll('.view-panel').forEach(function(el) { el.classList.remove('active'); });
  var target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');

  // Update sidebar nav
  document.querySelectorAll('#sidebar-nav a').forEach(function(a) {
    var isActive = /** @type {HTMLElement} */ (a).dataset.nav === view;
    if (isActive) {
      a.className = 'nav-item-active flex items-center gap-3 rounded-md font-bold px-4 py-3 font-headline text-sm cursor-pointer';
    } else {
      a.className = 'flex items-center gap-3 text-slate-400 hover:bg-slate-800 hover:text-slate-200 px-4 py-3 my-1 rounded-md transition-all font-headline text-sm cursor-pointer';
    }
  });

  // Update top nav
  document.querySelectorAll('header nav a').forEach(function(a) {
    var isActive = /** @type {HTMLElement} */ (a).dataset.nav === view;
    if (isActive) {
      a.className = 'font-body font-bold tracking-tight text-sm text-primary-container border-b-2 border-primary-container py-5 cursor-pointer';
    } else {
      a.className = 'font-body font-bold tracking-tight text-sm text-slate-400 hover:text-slate-200 transition-colors py-5 cursor-pointer';
    }
  });

  // If navigating to logs view and we have a selected job, show its logs
  if (view === 'logs' && selectedJobId) {
    var job = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (job) renderLogsView(job);
  }

  // If navigating to settings view, load configuration
  if (view === 'settings') {
    loadSettings();
  }

  // If navigating to repositories view, load from API
  if (view === 'repositories') {
    loadRepositories();
  }

  // If navigating to automations view, render it
  if (view === 'automations') {
    renderAutomationsPanel();
  }

  // If navigating to skip-events view, load data
  if (view === 'skip-events') {
    loadSkipEvents();
  }
}

// Bind navigation clicks
document.addEventListener('click', function(e) {
  var navEl = e.target instanceof Element ? /** @type {HTMLElement | null} */ (e.target.closest('[data-nav]')) : null;
  if (navEl) {
    e.preventDefault();
    var nav = navEl.dataset.nav;
    if (nav) navigateTo(nav);
  }
});

/* ══════════════════════════════════════════════════════════════
   Theme Toggle
   ══════════════════════════════════════════════════════════════ */
/** @returns {void} */
function toggleTheme() {
  var html = document.documentElement;
  var isDark = html.classList.contains('dark');
  var themeBtn = document.getElementById('btn-theme');
  if (isDark) {
    html.classList.remove('dark');
    localStorage.setItem('aqm-theme', 'light');
    if (themeBtn) themeBtn.textContent = 'light_mode';
  } else {
    html.classList.add('dark');
    localStorage.setItem('aqm-theme', 'dark');
    if (themeBtn) themeBtn.textContent = 'dark_mode';
  }
}

/* ══════════════════════════════════════════════════════════════
   Instance Label
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {string} label
 * @returns {void}
 */
function updateInstanceLabel(label) {
  var el = document.getElementById('instance-label');
  var section = document.getElementById('instance-label-section');
  var infoSection = document.getElementById('instance-info-section');
  if (!el) return;
  if (label) {
    el.textContent = label;
    if (section) section.classList.remove('hidden');
    if (infoSection) infoSection.classList.remove('hidden');
  } else {
    if (section) section.classList.add('hidden');
  }
}

/**
 * @param {string[]|null|undefined} owners
 * @returns {void}
 */
function updateInstanceOwners(owners) {
  var el = document.getElementById('instance-owners');
  var section = document.getElementById('instance-owners-section');
  var infoSection = document.getElementById('instance-info-section');
  if (!el) return;
  if (Array.isArray(owners) && owners.length > 0) {
    el.textContent = owners.join(', ');
    if (section) section.classList.remove('hidden');
    if (infoSection) infoSection.classList.remove('hidden');
  } else {
    if (section) section.classList.add('hidden');
  }
}

/** @returns {void} */
function loadInstanceLabel() {
  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.config && data.config.general) {
        var label = data.config.general.instanceLabel || data.config.general.projectName || '';
        updateInstanceLabel(label);
        updateInstanceOwners(data.config.general.instanceOwners);
        checkOwnersWarning(data.config.general.instanceOwners);
      }
    })
    .catch(function() {});
}

/** @returns {void} */
function loadClaudeProfile() {
  apiFetch('/api/claude-profile')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var el = document.getElementById('claude-profile-label');
      if (el && data.profile) {
        el.textContent = data.profile;
      }
    })
    .catch(function() {});
}

/* ══════════════════════════════════════════════════════════════
   Settings
   ══════════════════════════════════════════════════════════════ */
/** @type {AqmConfig|null} */
var currentConfig = null; // 현재 설정 데이터 저장

/**
 * @param {string} message
 * @returns {void}
 */
function showErrorMessage(message) {
  var container = document.getElementById('settings-content');
  if (!container) return;
  container.innerHTML = '<div class="col-span-full flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>' + message + '</div>';
}

/** @returns {void} */
function loadSettings() {
  var container = document.getElementById('settings-content');
  if (!container) return;

  // Show loading state
  container.innerHTML = '<div class="col-span-full flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>설정을 로딩 중...</div>';

  // Fetch configuration
  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.config) {
        currentConfig = data.config;
        // Clear loading state from settings-content
        if (container) container.innerHTML = '';
        // Try to render settings view with error handling
        try {
          renderSettingsView(data.config);
        } catch (renderError) {
          console.error('Settings render error:', renderError);
          showErrorMessage('설정을 렌더링하는데 실패했습니다: ' + (renderError instanceof Error ? renderError.message : String(renderError)));
        }
      } else {
        showErrorMessage('설정 데이터가 없습니다.');
      }
    })
    .catch(function(error) {
      showErrorMessage('설정을 불러오는데 실패했습니다.');
    });
}

/**
 * @param {string} tabName
 * @returns {void}
 */
function setSettingsTab(tabName) {
  var activeClasses = ['bg-primary/10', 'text-primary', 'shadow-sm'];
  var inactiveClasses = ['text-outline', 'hover:text-on-surface', 'hover:bg-surface-container-high'];
  document.querySelectorAll('.settings-tab-btn').forEach(function(btn) {
    var isActive = /** @type {HTMLElement} */ (btn).dataset.tab === tabName;
    activeClasses.forEach(function(c) { btn.classList.toggle(c, isActive); });
    inactiveClasses.forEach(function(c) { btn.classList.toggle(c, !isActive); });
  });

  document.querySelectorAll('.settings-tab-panel').forEach(function(panel) {
    var isActive = panel.id === 'settings-tab-' + tabName;
    panel.classList.toggle('hidden', !isActive);
  });

  localStorage.setItem('aqm-selected-tab', tabName);
}

/** @type {string|null} */
var _btnOriginal = null;
/** @type {ReturnType<typeof setTimeout>|null} */
var _btnTimer = null;

/**
 * @param {HTMLButtonElement} btn
 * @param {string} icon
 * @param {string} message
 * @param {string} colorClass
 * @returns {void}
 */
function showButtonState(btn, icon, message, colorClass) {
  if (_btnTimer) clearTimeout(_btnTimer);
  if (!_btnOriginal) _btnOriginal = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-base' + (icon === 'sync' ? ' animate-spin' : '') + '">' + icon + '</span><span>' + message + '</span>';
  btn.className = btn.className.replace(/bg-\S+/g, colorClass);

  if (icon !== 'sync') {
    _btnTimer = setTimeout(function() {
      btn.disabled = false;
      btn.innerHTML = _btnOriginal || '';
      btn.className = btn.className.replace(/bg-\S+/g, 'bg-primary');
      _btnOriginal = null;
      _btnTimer = null;
    }, 2000);
  }
}

/** @returns {void} */
function saveSettings() {
  var saveBtn = document.getElementById('save-settings-btn');
  if (!saveBtn || !currentConfig) return;

  showButtonState(/** @type {HTMLButtonElement} */ (saveBtn), 'sync', t('config.saveState.saving'), 'bg-primary');

  apiFetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectFormData())
  })
    .then(function(r) {
      if (r.ok) {
        showButtonState(/** @type {HTMLButtonElement} */ (saveBtn), 'check', t('config.saveState.saved'), 'bg-[#3fb950]');
        // Update currentConfig without re-rendering UI
        var newData = collectFormData();
        if (newData && currentConfig) Object.assign(currentConfig, newData);
      } else {
        throw new Error('Save failed');
      }
    })
    .catch(function() {
      showButtonState(/** @type {HTMLButtonElement} */ (saveBtn), 'error', t('config.saveState.saveFailed'), 'bg-[#f85149]');
    });
}

/**
 * @returns {Record<string, *>|null}
 */
function collectFormData() {
  if (!currentConfig) return null;

  // 변경 가능한 섹션만 수집 (projects 등 복잡한 구조 제외)
  var cfg = /** @type {Record<string, *>} */ (currentConfig);
  var result = /** @type {Record<string, *>} */ ({});

  ['general', 'safety', 'review'].forEach(function(section) {
    var form = document.getElementById(section + '-settings-form');
    if (!form) return;

    var sectionData = cfg[section] ? JSON.parse(JSON.stringify(cfg[section])) : {};
    var inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(function(input) {
      var path = /** @type {HTMLElement} */ (input).dataset.configPath;
      if (!path) return;

      var value = getInputValue(/** @type {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} */ (input));
      // path에서 섹션 prefix 제거 (예: "general.logLevel" → "logLevel")
      var subPath = path.startsWith(section + '.') ? path.slice(section.length + 1) : path;
      setNestedValue(sectionData, subPath, value);
    });
    result[section] = sectionData;
  });

  return result;
}

/**
 * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} input
 * @returns {*}
 */
function getInputValue(input) {
  switch (input.type) {
    case 'checkbox':
      return /** @type {HTMLInputElement} */ (input).checked;
    case 'number':
      return parseInt(input.value, 10) || 0;
    default:
      // comma-array 타입 처리 (예: instanceOwners)
      if (input.dataset.inputType === 'comma-array') {
        return input.value.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
      }
      // textarea이고 JSON 데이터인 경우 파싱 시도
      if (input.tagName.toLowerCase() === 'textarea') {
        try {
          return JSON.parse(input.value);
        } catch (e) {
          return input.value; // JSON 파싱 실패 시 문자열로 반환
        }
      }
      return input.value;
  }
}

/**
 * @param {Record<string, *>} obj
 * @param {string} path
 * @param {*} value
 * @returns {void}
 */
function setNestedValue(obj, path, value) {
  var keys = path.split('.');
  var current = obj;

  for (var i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
}

/* ══════════════════════════════════════════════════════════════
   Job Actions
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {string} id
 * @returns {void}
 */
function cancelJob(id) {
  showConfirm(t('cancelConfirm'), '').then(function(ok) {
    if (!ok) return;
    apiFetch('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })
      .then(function() { return apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData); })
      .catch(function() {});
  });
}

/**
 * @param {string} id
 * @returns {void}
 */
function retryJob(id) {
  apiFetch('/api/jobs/' + encodeURIComponent(id) + '/retry', { method: 'POST' })
    .then(function() { return apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData); })
    .catch(function() {});
}

/**
 * @param {string} id
 * @returns {void}
 */
function deleteJob(id) {
  apiFetch('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function(r) {
      if (r.ok) {
        if (selectedJobId === id) selectedJobId = null;
        apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData).catch(function() {});
      }
    })
    .catch(function() {});
}

/** @returns {void} */
function clearAllJobs() {
  showConfirm(t('clearAllConfirm'), currentLang === 'ko' ? '이 작업은 되돌릴 수 없습니다.' : 'This action cannot be undone.').then(function(ok) {
    if (!ok) return;
    var deletable = currentJobs.filter(function(j) { return j.status === 'success' || j.status === 'failure' || j.status === 'cancelled' || j.status === 'archived'; });
    Promise.all(deletable.map(function(j) {
      return apiFetch('/api/jobs/' + encodeURIComponent(j.id), { method: 'DELETE' }).catch(function() {});
    })).then(function() {
      selectedJobId = null;
      apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData).catch(function() {});
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   Project Actions
   ══════════════════════════════════════════════════════════════ */
/** @returns {void} */
function addProject() {
  var form = document.getElementById('add-project-form');
  if (!form) return;

  var htmlForm = asForm(form);
  if (!htmlForm) return;
  var formData = new FormData(htmlForm);
  var projectData = {
    repo: formData.get('repo'),
    path: formData.get('path')
  };

  // Validate form data
  if (!projectData.repo || !projectData.path) {
    showProjectMessage('저장소(owner/repo)와 로컬 경로를 모두 입력해주세요.', 'error');
    return;
  }

  // Show loading state on submit button
  var submitButton = /** @type {HTMLButtonElement | null} */ (form.querySelector('button[type="submit"]'));
  var originalButtonContent = submitButton ? submitButton.innerHTML : '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>추가 중...</span>';
  }

  // Send API request
  apiFetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(projectData)
  })
    .then(function(response) {
      if (response.ok) {
        return response.json().then(function(data) {
          // Success - clear form and reload settings
          if (htmlForm) htmlForm.reset();
          loadSettings();
          var msg = '프로젝트가 성공적으로 추가되었습니다.';
          if (data.detectedLanguage) {
            msg += ' <span class="font-bold">[' + esc(data.detectedLanguage) + ' 감지됨]</span>';
          }
          showProjectMessage(msg, 'success');
        });
      } else {
        return response.json().then(function(errorData) {
          throw new Error(errorData.error || '프로젝트 추가에 실패했습니다.');
        });
      }
    })
    .catch(function(error) {
      showProjectMessage(error.message || '프로젝트 추가 중 오류가 발생했습니다.', 'error');
    })
    .finally(function() {
      // Restore submit button
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonContent;
      }
    });
}

/**
 * @param {string} message
 * @param {string} type
 * @returns {void}
 */
function showProjectMessage(message, type) {
  var messageId = 'add-project-' + type;
  var existing = document.getElementById(messageId);
  if (existing) existing.remove();

  var config = type === 'error'
    ? { icon: 'error', color: '#f85149', timeout: 5000 }
    : { icon: 'check_circle', color: '#3fb950', timeout: 3000 };

  var messageEl = document.createElement('div');
  messageEl.id = messageId;
  messageEl.className = 'mt-4 p-3 rounded-lg text-sm flex items-center gap-2 border transition-opacity';
  messageEl.style.backgroundColor = config.color + '10';
  messageEl.style.borderColor = config.color + '4d';
  messageEl.style.color = config.color;
  messageEl.innerHTML = '<span class="material-symbols-outlined text-sm">' + config.icon + '</span>' + message;

  var form = document.getElementById('add-project-form');
  if (form) form.appendChild(messageEl);

  setTimeout(function() {
    if (messageEl && messageEl.parentNode) messageEl.remove();
  }, config.timeout);
}

/**
 * @param {string} label
 * @param {string} name
 * @param {string} value
 * @param {boolean} readonly
 * @returns {string}
 */
function createModalField(label, name, value, readonly) {
  var inputClass = 'w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none';
  var readonlyClass = readonly ? 'bg-surface-container-high/50 cursor-not-allowed' : 'bg-surface-container-high';
  var readonlyAttr = readonly ? ' readonly' : '';
  return '<div>' +
    '<label class="block text-sm font-bold text-on-surface mb-2">' + label + '</label>' +
    '<input type="text" name="' + name + '" value="' + esc(value) + '"' + readonlyAttr + ' class="' + inputClass + ' ' + readonlyClass + '">' +
    '</div>';
}

/**
 * @param {string} repo
 * @returns {void}
 */
function editProject(repo) {
  if (!currentConfig || !currentConfig.projects) return;

  var project = currentConfig.projects.find(function(p) { return p.repo === repo; });
  if (!project) {
    showProjectMessage('프로젝트를 찾을 수 없습니다.', 'error');
    return;
  }

  var existingModal = document.getElementById('edit-project-modal');
  if (existingModal) existingModal.remove();

  var fieldsHtml = createModalField('저장소 (owner/repo)', 'repo', project.repo, true);
  fieldsHtml += createModalField('로컬 경로', 'path', project.path, false);
  fieldsHtml += createModalField('기본 브랜치', 'baseBranch', project.baseBranch || '', false);
  if (project.mode !== undefined) {
    fieldsHtml += createModalField('모드', 'mode', project.mode || '', false);
  }

  var cmds = project.commands || {};
  fieldsHtml += '<div class="pt-2 pb-1"><span class="text-[10px] font-black uppercase text-primary tracking-widest">Commands</span></div>';
  fieldsHtml += createModalField('테스트 (test)', 'cmd_test', cmds.test || '', false);
  fieldsHtml += createModalField('타입체크 (typecheck)', 'cmd_typecheck', cmds.typecheck || '', false);
  fieldsHtml += createModalField('사전 설치 (preInstall)', 'cmd_preInstall', cmds.preInstall || '', false);
  fieldsHtml += createModalField('빌드 (build)', 'cmd_build', cmds.build || '', false);
  fieldsHtml += createModalField('린트 (lint)', 'cmd_lint', cmds.lint || '', false);

  var modalHtml = '<div id="edit-project-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">' +
    '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-md mx-4 border border-outline-variant/20 overflow-y-auto max-h-[90vh]">' +
    '<div class="flex justify-between items-center mb-4">' +
    '<h3 class="text-lg font-bold text-on-surface">프로젝트 편집</h3>' +
    '<button onclick="closeEditProjectModal()" class="text-outline hover:text-on-surface"><span class="material-symbols-outlined">close</span></button>' +
    '</div>' +
    '<form id="edit-project-form" class="space-y-4">' +
    fieldsHtml +
    '<div class="flex gap-2 pt-4">' +
    '<button type="submit" class="flex-1 bg-primary text-on-primary font-bold py-2 px-4 rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"><span class="material-symbols-outlined text-sm">save</span><span>저장</span></button>' +
    '<button type="button" onclick="closeEditProjectModal()" class="px-4 py-2 border border-outline-variant/30 rounded-lg text-outline hover:bg-surface-container-high transition-colors">취소</button>' +
    '</div>' +
    '</form>' +
    '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  var editFormEl = document.getElementById('edit-project-form');
  if (editFormEl) {
    editFormEl.addEventListener('submit', function(e) {
      e.preventDefault();
      submitEditProject(repo);
    });
  }

  var firstInput = /** @type {HTMLElement | null} */ (document.querySelector('#edit-project-form input[name="path"]'));
  if (firstInput) firstInput.focus();
}

/** @returns {void} */
function closeEditProjectModal() {
  var modal = document.getElementById('edit-project-modal');
  if (modal) modal.remove();
}

/**
 * @param {string} repo
 * @returns {void}
 */
function submitEditProject(repo) {
  var form = document.getElementById('edit-project-form');
  if (!form) return;

  var htmlForm = asForm(form);
  if (!htmlForm) return;
  var formData = new FormData(htmlForm);
  var updates = /** @type {Record<string, *>} */ ({});

  ['path', 'baseBranch', 'mode'].forEach(function(field) {
    var value = formData.get(field);
    if (field === 'path' ? value : value !== null) {
      updates[field] = value;
    }
  });

  var commands = {};
  var hasCommands = false;
  [['cmd_test', 'test'], ['cmd_typecheck', 'typecheck'], ['cmd_preInstall', 'preInstall'], ['cmd_build', 'build'], ['cmd_lint', 'lint']].forEach(function(pair) {
    var value = formData.get(pair[0]);
    if (typeof value === 'string' && value.trim() !== '') {
      // @ts-ignore
      commands[pair[1]] = value.trim();
      hasCommands = true;
    }
  });
  if (hasCommands) {
    // @ts-ignore
    updates.commands = commands;
  }

  // Show loading state on submit button
  var submitButton = /** @type {HTMLButtonElement | null} */ (form.querySelector('button[type="submit"]'));
  var originalButtonContent = submitButton ? submitButton.innerHTML : '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>저장 중...</span>';
  }

  // Send PUT request
  apiFetch('/api/projects/' + encodeURIComponent(repo), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  })
    .then(function(response) {
      if (response.ok) {
        // Success - close modal and reload settings
        closeEditProjectModal();
        loadSettings();
        showProjectMessage('프로젝트가 성공적으로 수정되었습니다.', 'success');
      } else {
        return response.json().then(function(errorData) {
          throw new Error(errorData.error || '프로젝트 수정에 실패했습니다.');
        });
      }
    })
    .catch(function(error) {
      showProjectMessage(error.message || '프로젝트 수정 중 오류가 발생했습니다.', 'error');
      // Restore submit button
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonContent;
      }
    });
}

/**
 * @param {string} id
 * @returns {void}
 */
function deleteProject(id) {
  showConfirm(t('deleteProjectConfirm'), currentLang === 'ko' ? '이 프로젝트를 삭제하시겠습니까?' : 'Are you sure you want to delete this project?').then(function(ok) {
    if (!ok) return;
    apiFetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function(r) {
        if (r.ok) {
          // Reload settings to refresh project list
          if (currentView === 'settings') {
            loadSettings();
          }
        }
      })
      .catch(function() {});
  });
}

/* ══════════════════════════════════════════════════════════════
   SSE Connection
   ══════════════════════════════════════════════════════════════ */
/** @type {EventSource|null} */
var es = null;
/** @type {ReturnType<typeof setTimeout>|null} */
var reconnectTimer = null;
/** @type {number} */
var reconnectDelay = 1000;
/** @type {number} */
var reconnectAttempts = 0;

/**
 * @param {'connected'|'connecting'|'disconnected'} state
 * @returns {void}
 */
function setConnState(state) {
  var dot = document.getElementById('conn-dot');
  var label = document.getElementById('conn-label');
  if (!dot || !label) return;
  if (state === 'connected') {
    dot.className = 'w-2 h-2 rounded-full bg-[#3fb950]';
    label.textContent = 'Connected';
  } else if (state === 'connecting') {
    dot.className = 'w-2 h-2 rounded-full bg-tertiary animate-pulse';
    label.textContent = currentLang === 'ko' ? '연결 중...' : 'Connecting...';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-outline';
    label.textContent = 'Disconnected';
  }
}

/** @returns {void} */
function connectSSE() {
  if (es) { try { es.close(); } catch(e) {} }
  setConnState('connecting');
  var key = getApiKey();
  var params = [];

  if (key) {
    params.push('key=' + encodeURIComponent(key));
  }

  if (currentProject && currentProject !== 'all') {
    params.push('project=' + encodeURIComponent(currentProject));
  }

  var sseUrl = '/api/events' + (params.length > 0 ? '?' + params.join('&') : '');
  es = new EventSource(sseUrl);
  es.onopen = function() {
    setConnState('connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelay = 1000;
    reconnectAttempts = 0;
  };
  es.onmessage = function(e) {
    try { handleData(JSON.parse(e.data)); } catch (_) {}
  };
  es.addEventListener('configChanged', function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.changes && data.changes.general) {
        var label = data.changes.general.instanceLabel || data.changes.general.projectName || '';
        updateInstanceLabel(label);
        updateInstanceOwners(data.changes.general.instanceOwners);
        checkOwnersWarning(data.changes.general.instanceOwners);
      }
      if (currentView === 'settings') {
        loadSettings();
      }
    } catch (_) {}
  });
  es.onerror = function() {
    setConnState('disconnected');
    if (es) es.close();
    reconnectAttempts++;
    reconnectTimer = setTimeout(connectSSE, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
}

/* ══════════════════════════════════════════════════════════════
   Version & Update Management
   ══════════════════════════════════════════════════════════════ */
/** @type {VersionInfo|null} */
var versionInfo = null;
/** @type {boolean} */
var updateDismissed = false;

/** @returns {void} */
function loadVersionInfo() {
  apiFetch('/api/version')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      versionInfo = data;
      updateVersionDisplay(data);
      checkForUpdates(data);
    })
    .catch(function() {
      // 버전 정보를 가져올 수 없는 경우 기본값 표시
      updateVersionDisplay({ currentVersion: 'unknown', currentHash: '' });
    });
}

/**
 * @param {VersionInfo} data
 * @returns {void}
 */
function updateVersionDisplay(data) {
  var versionLabel = document.getElementById('version-label');
  var versionHash = document.getElementById('version-hash');

  if (versionLabel) {
    versionLabel.textContent = 'v' + (data.currentVersion || 'unknown');
  }

  if (versionHash && data.currentHash && data.currentHash !== 'unknown') {
    versionHash.textContent = '(' + data.currentHash + ')';
  }
}

/**
 * @returns {number}
 */
function getApiBannerHeight() {
  var apiBanner = document.getElementById('api-key-banner');
  if (apiBanner && apiBanner.style.display !== 'none') {
    return apiBanner.offsetHeight;
  }
  return 0;
}

/**
 * @param {VersionInfo} data
 * @returns {void}
 */
function checkForUpdates(data) {
  if (updateDismissed || !data.hasUpdates) return;

  var updateBanner = document.getElementById('update-banner');
  var updateInfo = document.getElementById('update-info');
  if (!updateBanner || !updateInfo) return;

  var topOffset = getApiBannerHeight();
  document.documentElement.style.setProperty('--api-banner-height', topOffset + 'px');

  var message = data.currentHash !== 'unknown' && data.remoteHash !== 'unknown'
    ? data.currentHash + ' → ' + data.remoteHash + ' 업데이트 사용 가능'
    : '새 버전으로 업데이트할 수 있습니다.';

  updateInfo.textContent = message;
  updateBanner.style.display = 'flex';
  updateBanner.style.top = topOffset + 'px';
  adjustPagePadding();
}

/**
 * @param {string[]|null|undefined} owners
 * @returns {void}
 */
function checkOwnersWarning(owners) {
  var banner = document.getElementById('owners-warning-banner');
  if (!banner) return;

  var isEmpty = !Array.isArray(owners) || owners.length === 0;
  if (isEmpty) {
    var topOffset = getApiBannerHeight() + getUpdateBannerHeight();
    banner.style.top = topOffset + 'px';
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
  adjustPagePadding();
}

/**
 * @returns {number}
 */
function getUpdateBannerHeight() {
  var updateBanner = document.getElementById('update-banner');
  if (updateBanner && updateBanner.style.display !== 'none') {
    return updateBanner.offsetHeight;
  }
  return 0;
}

/** @returns {void} */
function adjustPagePadding() {
  var header = document.querySelector('header');
  var apiBanner = document.getElementById('api-key-banner');
  var updateBanner = document.getElementById('update-banner');
  var ownersBanner = document.getElementById('owners-warning-banner');

  if (!header) return;

  var totalBannerHeight = 0;
  if (apiBanner && apiBanner.style.display !== 'none') {
    totalBannerHeight += apiBanner.offsetHeight;
  }
  if (updateBanner && updateBanner.style.display !== 'none') {
    totalBannerHeight += updateBanner.offsetHeight;
  }
  if (ownersBanner && ownersBanner.style.display !== 'none') {
    totalBannerHeight += ownersBanner.offsetHeight;
  }

  // owners-warning-banner top을 api+update 배너 높이만큼 동적으로 조정
  if (ownersBanner && ownersBanner.style.display !== 'none') {
    var ownersBannerTop = 0;
    if (apiBanner && apiBanner.style.display !== 'none') {
      ownersBannerTop += apiBanner.offsetHeight;
    }
    if (updateBanner && updateBanner.style.display !== 'none') {
      ownersBannerTop += updateBanner.offsetHeight;
    }
    ownersBanner.style.top = ownersBannerTop + 'px';
  }

  // 헤더 top을 배너 높이만큼 동적으로 조정 (sticky header가 배너 아래로 밀리도록)
  header.style.top = totalBannerHeight > 0 ? totalBannerHeight + 'px' : '';

  // 헤더 아래 여백을 동적으로 조정
  var main = document.querySelector('main');
  if (main) {
    main.style.paddingTop = (totalBannerHeight > 0 ? totalBannerHeight + 'px' : '');
  }
}

/**
 * @param {string} icon
 * @param {string} text
 * @param {boolean} isLoading
 * @returns {void}
 */
function setUpdateButtonState(icon, text, isLoading) {
  var updateBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('update-btn'));
  var updateBtnIcon = document.getElementById('update-btn-icon');
  var updateBtnText = document.getElementById('update-btn-text');

  if (updateBtnIcon) {
    updateBtnIcon.textContent = icon;
    if (isLoading) {
      updateBtnIcon.classList.add('animate-spin');
    } else {
      updateBtnIcon.classList.remove('animate-spin');
    }
  }
  if (updateBtnText) {
    updateBtnText.textContent = text;
  }
  if (updateBtn) {
    updateBtn.disabled = isLoading;
  }
}

/** @returns {void} */
function performUpdate() {
  var updateBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('update-btn'));
  if (!updateBtn || updateBtn.disabled) return;

  var activeCount = currentJobs.filter(function(j) { return j.status === 'running' || j.status === 'queued'; }).length;
  var confirmPromise = activeCount > 0
    ? showConfirm('업데이트', activeCount + '개의 진행 중인 잡이 취소됩니다. 계속하시겠습니까?')
    : Promise.resolve(true);

  confirmPromise.then(function(ok) {
    if (!ok) return;

    setUpdateButtonState('sync', '업데이트 중...', true);

    apiFetch('/api/update', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.updated) {
        setUpdateButtonState('check', '완료', false);
        setTimeout(function() {
          if (data.needsRestart) {
            if (confirm('업데이트가 완료되었습니다. 변경사항을 적용하려면 페이지를 새로고침해야 합니다. 지금 새로고침하시겠습니까?')) {
              window.location.reload();
            }
          } else {
            dismissUpdate();
            loadVersionInfo();
          }
        }, 2000);
      } else {
        setUpdateButtonState('check', '최신 버전', false);
        setTimeout(function() { dismissUpdate(); }, 2000);
      }
    })
    .catch(function() {
      setUpdateButtonState('error', '실패', false);
      setTimeout(function() {
        setUpdateButtonState('download', '업데이트', false);
      }, 3000);
    });
  });
}

/** @returns {void} */
function dismissUpdate() {
  updateDismissed = true;
  var updateBanner = document.getElementById('update-banner');
  if (updateBanner) {
    updateBanner.style.display = 'none';
  }
  adjustPagePadding();
}

/* ══════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════ */
// Apply translations on load
applyTranslations();

// Update theme button icon based on current theme
(function() {
  var themeBtn = document.getElementById('btn-theme');
  if (themeBtn) {
    themeBtn.textContent = document.documentElement.classList.contains('dark') ? 'dark_mode' : 'light_mode';
  }
  initArchivedToggle();

  // Restore automations view toggle state
  if (currentAutomationsView === 'kanban' || currentAutomationsView === 'rules') {
    var btnList    = document.getElementById('btn-automations-list');
    var btnKanban  = document.getElementById('btn-automations-kanban');
    var btnRules   = document.getElementById('btn-automations-rules');
    var listView   = document.getElementById('automations-list-view');
    var kanbanView = document.getElementById('automations-kanban-view');
    var rulesView  = document.getElementById('automations-rules-view');
    var activeClass   = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors bg-primary/10 text-primary';
    var inactiveClass = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors text-outline hover:text-on-surface';
    if (btnList)   btnList.className   = inactiveClass;
    if (btnKanban) btnKanban.className = inactiveClass;
    if (btnRules)  btnRules.className  = inactiveClass;
    if (listView)   listView.classList.add('hidden');
    if (kanbanView) kanbanView.classList.add('hidden');
    if (rulesView)  rulesView.classList.add('hidden');
    if (currentAutomationsView === 'kanban') {
      if (btnKanban)  btnKanban.className = activeClass;
      if (kanbanView) kanbanView.classList.remove('hidden');
    } else {
      if (btnRules)  btnRules.className  = activeClass;
      if (rulesView) rulesView.classList.remove('hidden');
    }
  }
})();

// Bind project form submit event
document.addEventListener('submit', function(e) {
  if (e.target instanceof Element && e.target.id === 'add-project-form') {
    e.preventDefault();
    addProject();
  }
});

// Initial data fetch
apiFetch(buildJobsUrl())
  .then(function(r) { return r.json(); })
  .then(handleData)
  .catch(function() {});

// Load version info and check for updates
loadVersionInfo();

// Initialize project selection
initProjectSelection();

// Load instance label and Claude profile for header
loadInstanceLabel();
loadClaudeProfile();

connectSSE();

// 탭 활성화 시 SSE 재연결
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && (!es || es.readyState === EventSource.CLOSED)) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelay = 1000;
    connectSSE();
  }
});

// 글로벌 함수로 노출 (HTML onclick에서 호출 가능하도록)
/* ══════════════════════════════════════════════════════════════
   Project Selection Dropdown
   ══════════════════════════════════════════════════════════════ */
/** @returns {void} */
function toggleProjectDropdown() {
  var dropdown = document.getElementById('project-dropdown');
  if (!dropdown) return;

  if (dropdown.classList.contains('hidden')) {
    loadProjectList();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

/** @returns {void} */
function loadProjectList() {
  apiFetch('/api/projects')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allProjects = data.projects || [];
      renderProjectDropdown();
    })
    .catch(function() {
      allProjects = [];
      renderProjectDropdown();
    });
}

/** @returns {void} */
function renderProjectDropdown() {
  var container = document.getElementById('project-dropdown-content');
  if (!container) return;

  var html = '';

  // All Projects option
  var isAllSelected = currentProject === 'all';
  html += '<div class="project-option ' + (isAllSelected ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-high') + ' px-3 py-2 rounded-md cursor-pointer transition-colors text-sm" onclick="setProject(\'all\')">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="material-symbols-outlined text-sm">dashboard</span>';
  html += '<span>All Projects</span>';
  if (isAllSelected) html += '<span class="material-symbols-outlined text-sm ml-auto">check</span>';
  html += '</div></div>';

  // Individual projects
  allProjects.forEach(function(project) {
    var isSelected = currentProject === project.repo;
    html += '<div class="project-option ' + (isSelected ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-high') + ' px-3 py-2 rounded-md cursor-pointer transition-colors text-sm" onclick="setProject(\'' + esc(project.repo) + '\')">';
    html += '<div class="flex items-center gap-2">';
    html += '<span class="material-symbols-outlined text-sm">account_tree</span>';
    html += '<span>' + esc(project.repo) + '</span>';
    if (isSelected) html += '<span class="material-symbols-outlined text-sm ml-auto">check</span>';
    html += '</div></div>';
  });

  container.innerHTML = html;
}

/** @returns {void} */
function initProjectSelection() {
  // Load initial project list and update UI
  loadProjectList();
  updateProjectDropdownUI();

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('project-dropdown');
    var button = document.getElementById('project-selector');
    var target = /** @type {Node | null} */ (e.target);
    if (dropdown && button && !dropdown.contains(target) && !button.contains(target)) {
      dropdown.classList.add('hidden');
    }

    var jobDropdown = document.getElementById('job-project-dropdown');
    var jobButton = document.getElementById('job-project-filter');
    if (jobDropdown && jobButton && !jobDropdown.contains(/** @type {Node} */ (e.target)) && !jobButton.contains(/** @type {Node} */ (e.target))) {
      jobDropdown.classList.add('hidden');
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   Job Filter: Inline Project Dropdown
   ══════════════════════════════════════════════════════════════ */
function toggleJobProjectDropdown() {
  var dropdown = document.getElementById('job-project-dropdown');
  if (!dropdown) return;

  if (dropdown.classList.contains('hidden')) {
    renderJobProjectDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

function renderJobProjectDropdown() {
  var container = document.getElementById('job-project-dropdown-content');
  if (!container) return;

  var html = '';

  // All Projects option
  var isAllSelected = currentProject === 'all';
  html += '<div class="project-option ' + (isAllSelected ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-high') + ' px-3 py-2 rounded-md cursor-pointer transition-colors text-sm" onclick="setProject(\'all\')">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="material-symbols-outlined text-sm">dashboard</span>';
  html += '<span>All Projects</span>';
  if (isAllSelected) html += '<span class="material-symbols-outlined text-sm ml-auto">check</span>';
  html += '</div></div>';

  // Individual projects
  allProjects.forEach(function(project) {
    var isSelected = currentProject === project.repo;
    html += '<div class="project-option ' + (isSelected ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-high') + ' px-3 py-2 rounded-md cursor-pointer transition-colors text-sm" onclick="setProject(\'' + esc(project.repo) + '\')">';
    html += '<div class="flex items-center gap-2">';
    html += '<span class="material-symbols-outlined text-sm">account_tree</span>';
    html += '<span>' + esc(project.repo) + '</span>';
    if (isSelected) html += '<span class="material-symbols-outlined text-sm ml-auto">check</span>';
    html += '</div></div>';
  });

  container.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   Automations View Toggle
   ══════════════════════════════════════════════════════════════ */
/**
 * @param {'list'|'kanban'|'rules'} view
 * @returns {void}
 */
function setAutomationsView(view) {
  currentAutomationsView = view;
  localStorage.setItem('aqm-automations-view', view);

  var listView   = document.getElementById('automations-list-view');
  var kanbanView = document.getElementById('automations-kanban-view');
  var rulesView  = document.getElementById('automations-rules-view');
  var btnList    = document.getElementById('btn-automations-list');
  var btnKanban  = document.getElementById('btn-automations-kanban');
  var btnRules   = document.getElementById('btn-automations-rules');

  var activeClass   = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors bg-primary/10 text-primary';
  var inactiveClass = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors text-outline hover:text-on-surface';

  // Hide all views
  if (listView)   listView.classList.add('hidden');
  if (kanbanView) kanbanView.classList.add('hidden');
  if (rulesView)  rulesView.classList.add('hidden');

  // Reset all buttons
  if (btnList)   btnList.className   = inactiveClass;
  if (btnKanban) btnKanban.className = inactiveClass;
  if (btnRules)  btnRules.className  = inactiveClass;

  if (view === 'kanban') {
    if (kanbanView) kanbanView.classList.remove('hidden');
    if (btnKanban)  btnKanban.className = activeClass;
    renderAutomationsKanban();
  } else if (view === 'rules') {
    if (rulesView) rulesView.classList.remove('hidden');
    if (btnRules)  btnRules.className = activeClass;
    loadAutomationRules();
  } else {
    if (listView) listView.classList.remove('hidden');
    if (btnList)  btnList.className = activeClass;
    renderAutomationsList();
  }
}

/** @returns {void} */
function renderAutomationsList() {
  var listEl   = document.getElementById('automations-job-list');
  var detailEl = document.getElementById('automations-job-detail');
  var emptyEl  = document.getElementById('automations-empty-state');
  if (!listEl) return;

  var filtered = filterJobs(currentJobs);

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) { emptyEl.classList.remove('hidden'); emptyEl.classList.add('flex'); }
    if (detailEl) detailEl.innerHTML = '<div class="flex items-center justify-center h-full min-h-[300px] text-outline text-sm">' + t('noJobSelected') + '</div>';
    return;
  }

  if (emptyEl) { emptyEl.classList.add('hidden'); emptyEl.classList.remove('flex'); }

  if (!selectedJobId || !filtered.find(function(j) { return j.id === selectedJobId; })) {
    var firstActive = filtered.find(function(j) { return j.status === 'running' || j.status === 'queued'; });
    selectedJobId = (firstActive || filtered[0]).id;
  }

  listEl.innerHTML = filtered.map(function(j) {
    return renderJobListItem(j, j.id === selectedJobId);
  }).join('');

  if (detailEl) {
    var selectedJob = filtered.find(function(j) { return j.id === selectedJobId; }) || filtered[0];
    detailEl.innerHTML = renderJobDetail(selectedJob);
  }
}

/** @returns {void} */
function renderAutomationsKanban() {
  var boardEl = document.getElementById('kanban-board');
  if (!boardEl) return;
  boardEl.innerHTML = renderKanban(filterJobs(currentJobs));

  // Set up drag and drop for priority management
  if (typeof setupDragAndDrop === 'function') {
    setupDragAndDrop();
  }
}

/** @returns {void} */
function renderAutomationsPanel() {
  if (currentView !== 'automations') return;
  if (currentAutomationsView === 'kanban') {
    renderAutomationsKanban();
  } else if (currentAutomationsView === 'rules') {
    // rules view는 loadAutomationRules()로 직접 갱신 — SSE 업데이트 시 재로드 불필요
  } else {
    renderAutomationsList();
  }
}

// SSE/data 업데이트 시 automations 패널도 갱신
(function() {
  var orig = renderFromState;
  window['renderFromState'] = function() {
    orig();
    renderAutomationsPanel();
  };
})();

/* ══════════════════════════════════════════════════════════════
   Skip Events
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {SkipEvent} ev
 * @returns {string}
 */
function renderSkipEventRow(ev) {
  var sourceIcon = ev.source === 'webhook' ? 'webhook' : 'refresh';
  var time = typeof relativeTime === 'function' ? relativeTime(ev.createdAt) : ev.createdAt;
  return '<tr class="border-b border-outline-variant/10 hover:bg-surface-container transition-colors">' +
    '<td class="px-4 py-3 text-sm font-bold text-on-surface/80 whitespace-nowrap">#' + ev.issueNumber + '</td>' +
    '<td class="px-4 py-3 text-xs font-mono text-outline truncate max-w-[140px]" title="' + esc(ev.repo) + '">' + esc(ev.repo) + '</td>' +
    '<td class="px-4 py-3"><span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#f85149]/10 text-[#f85149] ring-1 ring-[#f85149]/20">' + esc(ev.reasonCode) + '</span></td>' +
    '<td class="px-4 py-3 text-xs text-outline/80 max-w-[200px] truncate" title="' + esc(ev.reasonMessage) + '">' + esc(ev.reasonMessage) + '</td>' +
    '<td class="px-4 py-3"><span class="flex items-center gap-1 text-[10px] text-outline"><span class="material-symbols-outlined text-[12px]">' + sourceIcon + '</span>' + esc(ev.source) + '</span></td>' +
    '<td class="px-4 py-3 text-[10px] text-outline whitespace-nowrap" title="' + esc(ev.createdAt) + '">' + time + '</td>' +
  '</tr>';
}

/** @returns {void} */
function loadSkipEvents() {
  var container = document.getElementById('skip-events-content');
  if (!container) return;
  container.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2 animate-spin align-middle">sync</span>로딩 중...</td></tr>';

  var el = /** @type {HTMLElement} */ (container);
  apiFetch('/api/skip-events?limit=100')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var events = /** @type {SkipEvent[]} */ (data.events || []);
      var total = data.pagination ? data.pagination.total : events.length;
      var totalEl = document.getElementById('skip-events-total');
      if (totalEl) totalEl.textContent = String(total);

      if (events.length === 0) {
        el.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-outline text-sm">스킵된 이벤트가 없습니다.</td></tr>';
        return;
      }
      el.innerHTML = events.map(renderSkipEventRow).join('');
    })
    .catch(function() {
      el.innerHTML = '<tr><td colspan="6" class="px-4 py-12 text-center text-[#f85149] text-sm">스킵 이벤트를 불러오는데 실패했습니다.</td></tr>';
    });
}

window.loadSkipEvents = loadSkipEvents;

window.setSettingsTab = setSettingsTab;
window.saveSettings = saveSettings;
window.editProject = editProject;
window.closeEditProjectModal = closeEditProjectModal;
window.performUpdate = performUpdate;
window.dismissUpdate = dismissUpdate;
window.toggleProjectDropdown = toggleProjectDropdown;
window.toggleJobProjectDropdown = toggleJobProjectDropdown;
window.setProject = setProject;
window.setAutomationsView = setAutomationsView;
