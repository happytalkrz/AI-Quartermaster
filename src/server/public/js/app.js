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
        renderSettingsView(data.config);
      } else {
        container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정 데이터가 없습니다.</div>';
      }
    })
    .catch(function(error) {
      container.innerHTML = '<div class="flex items-center justify-center py-16 text-outline text-sm"><span class="material-symbols-outlined text-lg mr-2">error</span>설정을 불러오는데 실패했습니다.</div>';
    });
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
  var existingEl = document.getElementById(messageId);

  // Remove existing message if any
  if (existingEl) {
    existingEl.remove();
  }

  // Create message element
  var messageEl = document.createElement('div');
  messageEl.id = messageId;

  if (type === 'error') {
    messageEl.className = 'mt-4 p-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded-lg text-[#f85149] text-sm flex items-center gap-2';
    messageEl.innerHTML = '<span class="material-symbols-outlined text-sm">error</span>' + message;
  } else if (type === 'success') {
    messageEl.className = 'mt-4 p-3 bg-[#3fb950]/10 border border-[#3fb950]/30 rounded-lg text-[#3fb950] text-sm flex items-center gap-2';
    messageEl.innerHTML = '<span class="material-symbols-outlined text-sm">check_circle</span>' + message;
  }

  // Append to form
  var form = document.getElementById('add-project-form');
  if (form) {
    form.appendChild(messageEl);
  }

  // Auto-hide after some time
  var hideTimeout = type === 'error' ? 5000 : 3000;
  setTimeout(function() {
    if (messageEl && messageEl.parentNode) {
      messageEl.remove();
    }
  }, hideTimeout);
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
