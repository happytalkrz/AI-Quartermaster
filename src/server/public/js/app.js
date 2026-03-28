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

// Initial data fetch
apiFetch('/api/jobs')
  .then(function(r) { return r.json(); })
  .then(handleData)
  .catch(function() {});

fetchStats();
connectSSE();
