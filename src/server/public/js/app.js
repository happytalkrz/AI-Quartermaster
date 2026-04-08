'use strict';

/* ══════════════════════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════════════════════ */
var currentView = 'dashboard';

function navigateTo(view) {
  currentView = view;
  // Update view panels
  document.querySelectorAll('.view-panel').forEach(function(el) { el.classList.remove('active'); });
  var target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');

  // Update sidebar nav
  document.querySelectorAll('#sidebar-nav a').forEach(function(a) {
    var isActive = a.dataset.nav === view;
    if (isActive) {
      a.className = 'nav-item-active flex items-center gap-3 rounded-md font-bold px-4 py-3 font-headline text-sm cursor-pointer';
    } else {
      a.className = 'flex items-center gap-3 text-slate-400 hover:bg-slate-800 hover:text-slate-200 px-4 py-3 my-1 rounded-md transition-all font-headline text-sm cursor-pointer';
    }
  });

  // Update top nav
  document.querySelectorAll('header nav a').forEach(function(a) {
    var isActive = a.dataset.nav === view;
    if (isActive) {
      a.className = 'font-body font-bold tracking-tight text-sm text-primary-container border-b-2 border-primary-container py-5 cursor-pointer';
    } else {
      a.className = 'font-body font-bold tracking-tight text-sm text-slate-400 hover:text-slate-200 transition-colors py-5 cursor-pointer';
    }
  });

  // If navigating to automations view, render kanban board
  if (view === 'automations') {
    updateKanbanBoard();
  }

  // If navigating to logs view and we have a selected job, show its logs
  if (view === 'logs' && selectedJobId) {
    var job = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (job) renderLogsView(job);
  }

  // If navigating to settings view, load configuration
  if (view === 'settings') {
    loadSettings();
  }
}

// Bind navigation clicks
document.addEventListener('click', function(e) {
  var navEl = e.target.closest('[data-nav]');
  if (navEl) {
    e.preventDefault();
    navigateTo(navEl.dataset.nav);
  }
});

/* ══════════════════════════════════════════════════════════════
   Theme Toggle
   ══════════════════════════════════════════════════════════════ */
function toggleTheme() {
  var html = document.documentElement;
  var isDark = html.classList.contains('dark');
  if (isDark) {
    html.classList.remove('dark');
    localStorage.setItem('aqm-theme', 'light');
    document.getElementById('btn-theme').textContent = 'light_mode';
  } else {
    html.classList.add('dark');
    localStorage.setItem('aqm-theme', 'dark');
    document.getElementById('btn-theme').textContent = 'dark_mode';
  }
}

/* ══════════════════════════════════════════════════════════════
   Settings
   ══════════════════════════════════════════════════════════════ */
var currentConfig = null; // 현재 설정 데이터 저장

function showErrorMessage(message) {
  var container = document.getElementById('settings-content');
  container.innerHTML = '<div class="col-span-full flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>' + message + '</div>';
}

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
        container.innerHTML = '';
        // Try to render settings view with error handling
        try {
          renderSettingsView(data.config);
        } catch (renderError) {
          console.error('Settings render error:', renderError);
          showErrorMessage('설정을 렌더링하는데 실패했습니다: ' + renderError.message);
        }
      } else {
        showErrorMessage('설정 데이터가 없습니다.');
      }
    })
    .catch(function(error) {
      showErrorMessage('설정을 불러오는데 실패했습니다.');
    });
}

function setSettingsTab(tabName) {
  var activeClasses = ['bg-primary/10', 'text-primary', 'shadow-sm'];
  var inactiveClasses = ['text-outline', 'hover:text-on-surface', 'hover:bg-surface-container-high'];
  document.querySelectorAll('.settings-tab-btn').forEach(function(btn) {
    var isActive = btn.dataset.tab === tabName;
    activeClasses.forEach(function(c) { btn.classList.toggle(c, isActive); });
    inactiveClasses.forEach(function(c) { btn.classList.toggle(c, !isActive); });
  });

  document.querySelectorAll('.settings-tab-panel').forEach(function(panel) {
    var isActive = panel.id === 'settings-tab-' + tabName;
    panel.classList.toggle('hidden', !isActive);
  });

  localStorage.setItem('aqm-selected-tab', tabName);
}

function showButtonState(btn, icon, message, colorClass) {
  var originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-base' + (icon === 'sync' ? ' animate-spin' : '') + '">' + icon + '</span><span>' + message + '</span>';
  btn.classList.replace('bg-primary', colorClass);

  setTimeout(function() {
    btn.disabled = false;
    btn.innerHTML = originalContent;
    btn.classList.replace(colorClass, 'bg-primary');
  }, 2000);
}

function saveSettings() {
  var saveBtn = document.getElementById('save-settings-btn');
  if (!saveBtn || !currentConfig) return;

  showButtonState(saveBtn, 'sync', t('config.saveState.saving'), 'bg-primary');

  apiFetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectFormData())
  })
    .then(function(r) {
      if (r.ok) {
        showButtonState(saveBtn, 'check', t('config.saveState.saved'), 'bg-[#3fb950]');
        // Reload settings to reflect changes immediately in UI
        loadSettings();
      } else {
        throw new Error('Save failed');
      }
    })
    .catch(function() {
      showButtonState(saveBtn, 'error', t('config.saveState.saveFailed'), 'bg-[#f85149]');
    });
}

function collectFormData() {
  if (!currentConfig) return null;

  var updatedConfig = JSON.parse(JSON.stringify(currentConfig)); // deep copy

  // 각 폼에서 데이터 수집
  ['general', 'safety', 'review'].forEach(function(section) {
    var form = document.getElementById(section + '-settings-form');
    if (!form) return;

    var inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(function(input) {
      var path = input.dataset.configPath;
      if (!path) return;

      var value = getInputValue(input);
      setNestedValue(updatedConfig, path, value);
    });
  });

  return updatedConfig;
}

function getInputValue(input) {
  switch (input.type) {
    case 'checkbox':
      return input.checked;
    case 'number':
      return parseInt(input.value, 10) || 0;
    default:
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
function cancelJob(id) {
  showConfirm(t('cancelConfirm'), '').then(function(ok) {
    if (!ok) return;
    apiFetch('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })
      .then(function() { return apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData); })
      .catch(function() {});
  });
}

function retryJob(id) {
  apiFetch('/api/jobs/' + encodeURIComponent(id) + '/retry', { method: 'POST' })
    .then(function() { return apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData); })
    .catch(function() {});
}

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
function addProject() {
  var form = document.getElementById('add-project-form');
  if (!form) return;

  var formData = new FormData(form);
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
  var submitButton = form.querySelector('button[type="submit"]');
  var originalButtonContent = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>추가 중...</span>';

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
        // Success - clear form and reload settings
        form.reset();
        loadSettings();
        showProjectMessage('프로젝트가 성공적으로 추가되었습니다.', 'success');
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
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonContent;
    });
}

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

function createModalField(label, name, value, readonly) {
  var inputClass = 'w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none';
  var readonlyClass = readonly ? 'bg-surface-container-high/50 cursor-not-allowed' : 'bg-surface-container-high';
  var readonlyAttr = readonly ? ' readonly' : '';
  return '<div>' +
    '<label class="block text-sm font-bold text-on-surface mb-2">' + label + '</label>' +
    '<input type="text" name="' + name + '" value="' + esc(value) + '"' + readonlyAttr + ' class="' + inputClass + ' ' + readonlyClass + '">' +
    '</div>';
}

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
  if (project.baseBranch !== undefined) {
    fieldsHtml += createModalField('기본 브랜치', 'baseBranch', project.baseBranch || '', false);
  }
  if (project.mode !== undefined) {
    fieldsHtml += createModalField('모드', 'mode', project.mode || '', false);
  }

  var modalHtml = '<div id="edit-project-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">' +
    '<div class="bg-surface-container-lowest rounded-xl p-6 w-full max-w-md mx-4 border border-outline-variant/20">' +
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

  document.getElementById('edit-project-form').addEventListener('submit', function(e) {
    e.preventDefault();
    submitEditProject(repo);
  });

  var firstInput = document.querySelector('#edit-project-form input[name="path"]');
  if (firstInput) firstInput.focus();
}

function closeEditProjectModal() {
  var modal = document.getElementById('edit-project-modal');
  if (modal) modal.remove();
}

function submitEditProject(repo) {
  var form = document.getElementById('edit-project-form');
  if (!form) return;

  var formData = new FormData(form);
  var updates = {};

  ['path', 'baseBranch', 'mode'].forEach(function(field) {
    var value = formData.get(field);
    if (field === 'path' ? value : value !== null) {
      updates[field] = value;
    }
  });

  // Show loading state on submit button
  var submitButton = form.querySelector('button[type="submit"]');
  var originalButtonContent = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span><span>저장 중...</span>';

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
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonContent;
    });
}

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
var es = null;
var reconnectTimer = null;

function setConnState(state) {
  var dot = document.getElementById('conn-dot');
  var label = document.getElementById('conn-label');
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
  };
  es.onmessage = function(e) {
    try {
      handleData(JSON.parse(e.data));
      if (currentView === 'automations') {
        updateKanbanBoard();
      }
    } catch (_) {}
  };
  es.onerror = function() {
    setConnState('disconnected');
    es.close();
    reconnectTimer = setTimeout(connectSSE, 4000);
  };
}

/* ══════════════════════════════════════════════════════════════
   Version & Update Management
   ══════════════════════════════════════════════════════════════ */
var versionInfo = null;
var updateDismissed = false;

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

function getApiBannerHeight() {
  var apiBanner = document.getElementById('api-key-banner');
  if (apiBanner && apiBanner.style.display !== 'none') {
    return apiBanner.offsetHeight;
  }
  return 0;
}

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

function adjustPagePadding() {
  var header = document.querySelector('header');
  var apiBanner = document.getElementById('api-key-banner');
  var updateBanner = document.getElementById('update-banner');

  if (!header) return;

  var totalBannerHeight = 0;
  if (apiBanner && apiBanner.style.display !== 'none') {
    totalBannerHeight += apiBanner.offsetHeight;
  }
  if (updateBanner && updateBanner.style.display !== 'none') {
    totalBannerHeight += updateBanner.offsetHeight;
  }

  // 헤더 아래 여백을 동적으로 조정
  var main = document.querySelector('main');
  if (main) {
    main.style.paddingTop = (totalBannerHeight > 0 ? totalBannerHeight + 'px' : '');
  }
}

function setUpdateButtonState(icon, text, isLoading) {
  var updateBtn = document.getElementById('update-btn');
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

function performUpdate() {
  var updateBtn = document.getElementById('update-btn');
  if (!updateBtn || updateBtn.disabled) return;

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
}

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
})();

// Bind project form submit event
document.addEventListener('submit', function(e) {
  if (e.target.id === 'add-project-form') {
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

connectSSE();

// 글로벌 함수로 노출 (HTML onclick에서 호출 가능하도록)
/* ══════════════════════════════════════════════════════════════
   Project Selection Dropdown
   ══════════════════════════════════════════════════════════════ */
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

function initProjectSelection() {
  // Load initial project list and update UI
  loadProjectList();
  updateProjectDropdownUI();

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('project-dropdown');
    var button = document.getElementById('project-selector');
    if (dropdown && button && !dropdown.contains(e.target) && !button.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

window.setSettingsTab = setSettingsTab;
window.saveSettings = saveSettings;
window.editProject = editProject;
window.closeEditProjectModal = closeEditProjectModal;
window.performUpdate = performUpdate;
window.dismissUpdate = dismissUpdate;
window.toggleProjectDropdown = toggleProjectDropdown;
window.setProject = setProject;
