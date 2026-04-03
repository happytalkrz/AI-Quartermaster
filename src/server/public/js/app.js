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

function loadSettings() {
  var container = document.getElementById('settings-content');
  if (!container) return;

  // Show loading state
  container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2 animate-spin">sync</span>설정을 로딩 중...</div>';

  // Fetch configuration
  apiFetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.config) {
        currentConfig = data.config;
        renderSettingsView(data.config);
      } else {
        container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정 데이터가 없습니다.</div>';
      }
    })
    .catch(function(error) {
      container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정을 불러오는데 실패했습니다.</div>';
    });
}

function setSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab-btn').forEach(function(btn) {
    var isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('bg-primary/10 text-primary', isActive);
    btn.classList.toggle('text-outline hover:text-on-surface hover:bg-surface-container-high', !isActive);
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
    body: JSON.stringify({ config: collectFormData() })
  })
    .then(function(r) {
      if (r.ok) {
        showButtonState(saveBtn, 'check', t('config.saveState.saved'), 'bg-[#3fb950]');
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
      .then(function() { return apiFetch('/api/jobs').then(function(r) { return r.json(); }).then(handleData); })
      .catch(function() {});
  });
}

function retryJob(id) {
  apiFetch('/api/jobs/' + encodeURIComponent(id) + '/retry', { method: 'POST' })
    .then(function() { return apiFetch('/api/jobs').then(function(r) { return r.json(); }).then(handleData); })
    .catch(function() {});
}

function deleteJob(id) {
  apiFetch('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function(r) {
      if (r.ok) {
        if (selectedJobId === id) selectedJobId = null;
        apiFetch('/api/jobs').then(function(r) { return r.json(); }).then(handleData).catch(function() {});
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
      apiFetch('/api/jobs').then(function(r) { return r.json(); }).then(handleData).catch(function() {});
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
    label: formData.get('label')
  };

  // Validate form data
  if (!projectData.repo || !projectData.label) {
    showProjectMessage('저장소 경로와 트리거 라벨을 모두 입력해주세요.', 'error');
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
  var sseUrl = key ? '/api/events?key=' + encodeURIComponent(key) : '/api/events';
  es = new EventSource(sseUrl);
  es.onopen = function() {
    setConnState('connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };
  es.onmessage = function(e) {
    try { handleData(JSON.parse(e.data)); } catch (_) {}
  };
  es.onerror = function() {
    setConnState('disconnected');
    es.close();
    reconnectTimer = setTimeout(connectSSE, 4000);
  };
}

/* ══════════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════════ */
// Apply translations on load
applyTranslations();

// Restore saved theme
(function() {
  var saved = localStorage.getItem('aqm-theme');
  if (saved === 'light') {
    document.documentElement.classList.remove('dark');
    document.getElementById('btn-theme').textContent = 'light_mode';
  }
  // Restore archived toggle
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
apiFetch('/api/jobs')
  .then(function(r) { return r.json(); })
  .then(handleData)
  .catch(function() {});

connectSSE();

// 글로벌 함수로 노출 (HTML onclick에서 호출 가능하도록)
window.setSettingsTab = setSettingsTab;
window.saveSettings = saveSettings;
