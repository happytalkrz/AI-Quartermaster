// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Repositories View
   ══════════════════════════════════════════════════════════════ */

/** @returns {void} */
function loadRepositories() {
  apiFetch('/api/repositories')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var repos = (data.repositories || []).map(function(/** @type {any} */ item) {
        var localPathStatus = item.health && item.health.localPath ? item.health.localPath.status : 'ok';
        var health = localPathStatus === 'error' ? 'local-missing' : (item.status === 'healthy' ? 'stable' : item.status);
        var stats = item.stats || {};
        var lastActivity = stats.lastActivity || null;
        var isActive = lastActivity !== null && (Date.now() - new Date(lastActivity).getTime()) < 7 * 24 * 60 * 60 * 1000;
        return /** @type {RepoInfo} */ ({
          repo: item.repository || item.name,
          path: item.path,
          totalJobs: stats.totalJobs || 0,
          successRate: stats.successRate,
          totalCostUsd: stats.totalCostUsd || 0,
          worktreeCount: item.worktreeCount || 0,
          lastActiveAt: lastActivity,
          isActive: isActive,
          health: health
        });
      });
      renderRepositoriesView(repos, {});
    })
    .catch(function() {
      renderRepositoriesView([], {});
    });
}

/**
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

/**
 * @param {RepoInfo} repo
 * @returns {string}
 */
function renderRepoCard(repo) {
  var isActive = repo.isActive;
  var health = repo.health || 'stable';

  var statusBadge = isActive
    ? '<div class="flex items-center gap-2 px-3 py-1 bg-surface-container-lowest rounded-full">' +
        '<span class="w-2 h-2 rounded-full bg-[#3fb950] animate-pulse"></span>' +
        '<span class="text-[10px] font-headline font-bold uppercase tracking-tighter">Active</span>' +
      '</div>'
    : '<div class="flex items-center gap-2 px-3 py-1 bg-surface-container-lowest rounded-full">' +
        '<span class="w-2 h-2 rounded-full bg-outline"></span>' +
        '<span class="text-[10px] font-headline font-bold uppercase tracking-tighter text-outline">Inactive</span>' +
      '</div>';

  var healthHtml = (health === 'local-missing')
    ? '<div class="flex gap-1 items-center">' +
        '<span class="w-1.5 h-1.5 rounded-full bg-[#3fb950]"></span>' +
        '<span class="w-1.5 h-1.5 rounded-full bg-error"></span>' +
        '<span class="text-[10px] text-error font-bold ml-1">LOCAL MISSING</span>' +
      '</div>'
    : '<div class="flex gap-1 items-center">' +
        '<span class="w-1.5 h-1.5 rounded-full bg-[#3fb950]"></span>' +
        '<span class="w-1.5 h-1.5 rounded-full bg-[#3fb950]"></span>' +
        '<span class="text-[10px] text-outline ml-1">STABLE</span>' +
      '</div>';

  var statsClass = isActive ? '' : ' grayscale opacity-60';
  var successRate = (repo.successRate !== null && repo.successRate !== undefined) ? repo.successRate : null;
  var successColor = (successRate !== null && successRate >= 90) ? 'text-[#3fb950]' : 'text-tertiary';
  var successText = successRate !== null ? successRate + '%' : '—';
  var costText = (repo.totalCostUsd !== null && repo.totalCostUsd !== undefined)
    ? '$' + Number(repo.totalCostUsd).toFixed(2) : '$0.00';
  var cacheText = (repo.cacheHitRatio !== null && repo.cacheHitRatio !== undefined && repo.cacheHitRatio > 0)
    ? Math.round(repo.cacheHitRatio * 100) + '%' : '—';
  var lastActiveText = repo.lastActiveAt ? relativeTime(repo.lastActiveAt) : '—';

  var footerButtons = (health === 'local-missing')
    ? '<div class="flex gap-2">' +
        '<button onclick="relinkRepo(\'' + esc(repo.repo) + '\')" class="px-3 py-1 bg-primary text-on-primary text-[10px] font-headline font-bold uppercase tracking-widest rounded hover:bg-primary-container transition-colors">RE-LINK</button>' +
        '<button onclick="deleteRepo(\'' + esc(repo.repo) + '\')" class="p-1.5 hover:text-error transition-colors"><span class="material-symbols-outlined text-sm">delete</span></button>' +
      '</div>'
    : '<div class="flex gap-2">' +
        '<button onclick="openRepoTerminal(\'' + esc(repo.repo) + '\')" class="p-1.5 hover:text-primary transition-colors" title="터미널"><span class="material-symbols-outlined text-sm">terminal</span></button>' +
        '<button onclick="syncRepo(\'' + esc(repo.repo) + '\')" class="p-1.5 hover:text-primary transition-colors" title="동기화"><span class="material-symbols-outlined text-sm">sync</span></button>' +
        '<button onclick="deleteRepo(\'' + esc(repo.repo) + '\')" class="p-1.5 hover:text-error transition-colors" title="삭제"><span class="material-symbols-outlined text-sm">delete</span></button>' +
      '</div>';

  return '<div class="repo-card-dynamic bg-surface-container-high rounded-xl overflow-hidden flex flex-col transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/40">' +
    '<div class="p-6 flex-1">' +
      '<div class="flex justify-between items-start mb-4">' +
        '<div>' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<h3 class="text-lg font-headline font-bold text-primary">' + esc(repo.repo) + '</h3>' +
            '<span class="material-symbols-outlined text-sm text-outline">open_in_new</span>' +
          '</div>' +
          '<p class="text-xs font-mono text-outline">' + esc(repo.path || '') + '</p>' +
        '</div>' +
        statusBadge +
      '</div>' +
      '<div class="grid grid-cols-4 gap-3 mb-6">' +
        '<div class="space-y-1">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline">Branch</p>' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="material-symbols-outlined text-xs text-primary">account_tree</span>' +
            '<span class="font-mono text-sm">' + esc(repo.baseBranch || 'main') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="space-y-1">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline">Worktrees</p>' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="material-symbols-outlined text-xs text-tertiary">layers</span>' +
            '<span class="font-mono text-sm">' + (repo.worktreeCount || 0) + ' active</span>' +
          '</div>' +
        '</div>' +
        '<div class="space-y-1">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline">Health</p>' +
          healthHtml +
        '</div>' +
      '</div>' +
      '<div class="bg-surface-container-low rounded-lg p-4 grid grid-cols-4 divide-x divide-outline-variant/20' + statsClass + '">' +
        '<div class="px-2 text-center">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline mb-1">Jobs</p>' +
          '<p class="text-xl font-headline font-bold">' + (repo.totalJobs || 0) + '</p>' +
        '</div>' +
        '<div class="px-2 text-center">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline mb-1">Success</p>' +
          '<p class="text-xl font-headline font-bold ' + successColor + '">' + successText + '</p>' +
        '</div>' +
        '<div class="px-2 text-center">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline mb-1">Cost</p>' +
          '<p class="text-xl font-headline font-bold text-tertiary">' + costText + '</p>' +
        '</div>' +
        '<div class="px-2 text-center">' +
          '<p class="text-[10px] font-headline uppercase tracking-widest text-outline mb-1">Cache</p>' +
          '<p class="text-xl font-headline font-bold text-primary">' + cacheText + '</p>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="px-6 py-3 bg-surface-container-highest flex justify-between items-center border-t border-white/5">' +
      '<span class="text-[10px] text-outline font-body flex items-center gap-1">' +
        '<span class="material-symbols-outlined text-xs">schedule</span>' +
        lastActiveText +
      '</span>' +
      footerButtons +
    '</div>' +
  '</div>';
}

/**
 * @param {StorageData} storageData
 * @returns {void}
 */
function renderStorageSection(storageData) {
  var data = storageData || {};
  var dbSizeEl = document.getElementById('repo-stat-db-size');
  var logSizeEl = document.getElementById('repo-stat-log-size');
  var retentionBarEl = document.getElementById('repo-retention-bar');
  var retentionLabelEl = document.getElementById('repo-retention-label');

  if (dbSizeEl) dbSizeEl.textContent = fmtBytes(data.dbSizeBytes);
  if (logSizeEl) logSizeEl.textContent = fmtBytes(data.logSizeBytes);
  var pct = data.retentionPct || 0;
  if (retentionBarEl) retentionBarEl.style.width = pct + '%';
  if (retentionLabelEl) retentionLabelEl.textContent = pct + '% Capacity Reached';
}

/**
 * @param {RepoInfo[]} repos
 * @param {StorageData} storageData
 * @returns {void}
 */
function renderRepositoriesView(repos, storageData) {
  var grid = document.getElementById('repo-card-grid');
  if (!grid) return;

  // Remove loading placeholder
  var placeholder = document.getElementById('repo-loading-placeholder');
  if (placeholder) placeholder.remove();

  // Remove previously injected cards
  grid.querySelectorAll('.repo-card-dynamic').forEach(function(el) { el.remove(); });

  // Inject repo cards
  var repoList = Array.isArray(repos) ? repos : [];
  if (repoList.length === 0) {
    grid.insertAdjacentHTML('beforeend',
      '<div class="repo-card-dynamic bg-surface-container rounded-xl p-6 flex flex-col items-center justify-center min-h-[200px] ring-1 ring-outline-variant/10">' +
        '<span class="material-symbols-outlined text-4xl text-outline/20 mb-3">inventory_2</span>' +
        '<p class="text-sm text-outline font-body">등록된 레포지토리가 없습니다.</p>' +
      '</div>'
    );
  } else {
    repoList.forEach(function(repo) {
      if (grid) grid.insertAdjacentHTML('beforeend', renderRepoCard(repo));
    });
  }

  renderStorageSection(storageData);
}

/** @returns {void} */
function showAddRepositoryDialog() {
  navigateTo('settings');
  showProjectMessage('설정 페이지에서 프로젝트를 추가할 수 있습니다.', 'success');
}

/** @returns {void} */
function cleanOldData() {
  showConfirm(
    t('cleanData') || '오래된 데이터 정리',
    t('cleanDataDesc') || '30일 이상 된 완료/실패 작업 데이터를 삭제합니다.'
  ).then(function(ok) {
    if (!ok) return;
    apiFetch('/api/jobs?status=archived', { method: 'DELETE' })
      .then(function() { loadRepositories(); })
      .catch(function() {});
  });
}

/** @param {string} repo */
function deleteRepo(repo) {
  showConfirm(
    t('deleteRepo') || '저장소 삭제',
    repo + ' 저장소를 삭제하시겠습니까?'
  ).then(function(ok) {
    if (!ok) return;
    apiFetch('/api/projects/' + encodeURIComponent(repo), { method: 'DELETE' })
      .then(function(r) {
        if (r.ok) loadRepositories();
      })
      .catch(function() {});
  });
}

/** @param {string} repo */
function syncRepo(repo) {
  showProjectMessage(repo + ' 동기화 중...', 'success');
  // Sync triggers a reload of repository data
  loadRepositories();
}

/** @param {string} repo */
function openRepoTerminal(repo) {
  showProjectMessage('터미널 기능은 준비 중입니다.', 'success');
}

/** @param {string} repo */
function relinkRepo(repo) {
  navigateTo('settings');
  showProjectMessage(repo + ' 경로를 설정 페이지에서 수정하세요.', 'success');
}

// Hook into navigateTo for repositories view
document.addEventListener('DOMContentLoaded', function() {
  var orig = window.navigateTo;
  if (typeof orig === 'function') {
    window.navigateTo = function(view) {
      orig(view);
      if (view === 'repositories') {
        loadRepositories();
      }
    };
  }
});

window.showAddRepositoryDialog = showAddRepositoryDialog;
window.cleanOldData = cleanOldData;
window.deleteRepo = deleteRepo;
window.syncRepo = syncRepo;
window.openRepoTerminal = openRepoTerminal;
window.relinkRepo = relinkRepo;

/* ══════════════════════════════════════════════════════════════
   Responsive Activity Log Handler
   ══════════════════════════════════════════════════════════════ */
window.addEventListener('resize', function() {
  // Re-render mobile activity log when window size changes
  if (selectedJobId && currentJobs) {
    var selectedJob = currentJobs.find(function(j) { return j.id === selectedJobId; });
    if (selectedJob) {
      renderMobileActivityLog(selectedJob);
    }
  }
});
