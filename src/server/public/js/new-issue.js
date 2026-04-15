// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   New Issue
   ══════════════════════════════════════════════════════════════ */

var CATEGORY_CONFIG = {
  bug: {
    whatLabel: '무엇이 잘못되었나요?',
    whereLabel: '어디서 발생하나요?',
    howLabel: '재현 방법 / 원인 분석',
    template: '## 버그 리포트\n\n**무엇이 잘못되었나요?**\n{{what}}\n\n**어디서 발생하나요?**\n{{where}}\n\n**재현 방법 / 원인 분석**\n{{how}}\n\n**관련 파일**\n{{files}}\n\n---\n\n### 예상 동작\n\n### 실제 동작',
  },
  feature: {
    whatLabel: '어떤 기능을 추가하나요?',
    whereLabel: '어느 영역에 추가하나요?',
    howLabel: '구현 방향 / 접근법',
    template: '## 기능 요청\n\n**어떤 기능을 추가하나요?**\n{{what}}\n\n**어느 영역에 추가하나요?**\n{{where}}\n\n**구현 방향 / 접근법**\n{{how}}\n\n**관련 파일**\n{{files}}\n\n---\n\n### 배경 / 동기\n\n### 수용 기준 (Acceptance Criteria)\n\n- [ ] \n- [ ] ',
  },
  refactor: {
    whatLabel: '무엇을 개선하나요?',
    whereLabel: '대상 위치',
    howLabel: '리팩터링 방법 / 전략',
    template: '## 리팩터링\n\n**무엇을 개선하나요?**\n{{what}}\n\n**대상 위치**\n{{where}}\n\n**리팩터링 방법 / 전략**\n{{how}}\n\n**관련 파일**\n{{files}}\n\n---\n\n### 현재 문제점\n\n### 목표 상태',
  },
  docs: {
    whatLabel: '무엇을 문서화하나요?',
    whereLabel: '문서 위치',
    howLabel: '작성 방법 / 범위',
    template: '## 문서 작업\n\n**무엇을 문서화하나요?**\n{{what}}\n\n**문서 위치**\n{{where}}\n\n**작성 방법 / 범위**\n{{how}}\n\n**관련 파일**\n{{files}}\n\n---\n\n### 문서 유형\n\n- [ ] README 업데이트\n- [ ] API 문서\n- [ ] 사용 가이드\n\n### 대상 독자',
  },
};

/**
 * @returns {string}
 */
function getSelectedCategory() {
  var checked = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="new-issue-category"]:checked'));
  return checked ? checked.value : 'bug';
}

/** @returns {void} */
function updateCategoryCardStyles() {
  var selected = getSelectedCategory();
  document.querySelectorAll('.new-issue-cat-card').forEach(function(card) {
    var inner = card.querySelector('.new-issue-cat-inner');
    var cat = /** @type {HTMLElement} */ (card).dataset.cat;
    var icon = card.querySelector('.material-symbols-outlined');
    if (!inner) return;
    if (cat === selected) {
      inner.className = 'flex items-center gap-2 p-3 rounded-xl border-2 border-primary bg-primary/10 transition-colors new-issue-cat-inner';
      if (icon) icon.className = 'material-symbols-outlined text-base text-primary';
    } else {
      inner.className = 'flex items-center gap-2 p-3 rounded-xl border-2 border-outline-variant/30 bg-surface-container hover:border-primary/40 transition-colors new-issue-cat-inner';
      if (icon) icon.className = 'material-symbols-outlined text-base text-outline';
    }
  });
}

/** @returns {void} */
function updateFieldLabels() {
  var cat = getSelectedCategory();
  var cfg = CATEGORY_CONFIG[/** @type {keyof typeof CATEGORY_CONFIG} */ (cat)];
  if (!cfg) return;
  var whatLabel = document.getElementById('new-issue-what-label');
  var whereLabel = document.getElementById('new-issue-where-label');
  var howLabel = document.getElementById('new-issue-how-label');
  if (whatLabel) whatLabel.textContent = cfg.whatLabel;
  if (whereLabel) whereLabel.textContent = cfg.whereLabel;
  if (howLabel) howLabel.textContent = cfg.howLabel;
}

/**
 * Simple markdown to HTML converter for preview.
 * @param {string} md
 * @returns {string}
 */
function renderMarkdown(md) {
  var lines = md.split('\n');
  var html = '';
  var inList = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Heading h2
    if (/^## /.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h2 class="text-base font-bold text-on-surface mt-4 mb-2">' + escapeHtml(line.slice(3)) + '</h2>';
      continue;
    }
    // Heading h3
    if (/^### /.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h3 class="text-sm font-bold text-on-surface mt-3 mb-1">' + escapeHtml(line.slice(4)) + '</h3>';
      continue;
    }
    // HR
    if (/^---$/.test(line.trim())) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr class="border-outline-variant/30 my-3" />';
      continue;
    }
    // List item (including task list)
    if (/^- /.test(line)) {
      if (!inList) { html += '<ul class="list-disc list-inside space-y-0.5 text-on-surface/80">'; inList = true; }
      var listContent = line.slice(2);
      // Task list checkbox
      listContent = listContent.replace(/^\[x\] /i, '<span class="line-through text-outline">').replace(/^\[ \] /, '<span class="text-outline">');
      html += '<li class="text-sm">' + inlineMd(listContent) + '</li>';
      continue;
    }
    // Empty line
    if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    // HTML comment — skip
    if (/^<!--/.test(line.trim())) {
      continue;
    }
    // Paragraph
    if (inList) { html += '</ul>'; inList = false; }
    html += '<p class="text-sm text-on-surface/90">' + inlineMd(line) + '</p>';
  }

  if (inList) html += '</ul>';
  return html;
}

/**
 * @param {string} text
 * @returns {string}
 */
function inlineMd(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-surface-container-highest/60 px-1 rounded text-xs font-mono">$1</code>');
}

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @returns {void} */
function updatePreview() {
  var cat = getSelectedCategory();
  var cfg = CATEGORY_CONFIG[/** @type {keyof typeof CATEGORY_CONFIG} */ (cat)];
  if (!cfg) return;

  var what = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-what'));
  var where = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-where'));
  var how = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-how'));
  var files = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-files'));
  var title = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-title'));
  var previewTitle = document.getElementById('new-issue-preview-title');
  var previewEl = document.getElementById('new-issue-preview');

  if (!previewEl) return;

  var whatVal = what ? what.value : '';
  var whereVal = where ? where.value : '';
  var howVal = how ? how.value : '';
  var filesVal = files ? files.value : '';
  var titleVal = title ? title.value.trim() : '';

  if (previewTitle) {
    previewTitle.textContent = titleVal || '(제목 없음)';
  }

  var md = cfg.template
    .replace('{{what}}', whatVal || '_(미입력)_')
    .replace('{{where}}', whereVal || '_(미입력)_')
    .replace('{{how}}', howVal || '_(미입력)_')
    .replace('{{files}}', filesVal || '_(없음)_');

  previewEl.innerHTML = renderMarkdown(md);
}

/**
 * @param {string} repo
 * @returns {void}
 */
function selectRepo(repo) {
  var hiddenInput = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-repo'));
  var display = document.getElementById('new-issue-repo-display');
  var dropdown = document.getElementById('new-issue-repo-dropdown');
  var chevron = document.getElementById('new-issue-repo-chevron');
  var trigger = document.getElementById('new-issue-repo-trigger');
  if (hiddenInput) hiddenInput.value = repo;
  if (display) {
    display.textContent = repo;
    display.className = 'text-sm text-primary font-medium';
  }
  if (dropdown) dropdown.classList.add('hidden');
  if (chevron) chevron.textContent = 'expand_more';
  if (trigger) trigger.classList.remove('border-primary');
}

/** @returns {void} */
function loadNewIssueRepos() {
  var dropdown = document.getElementById('new-issue-repo-dropdown');
  if (!dropdown) return;
  apiFetch('/api/projects')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!Array.isArray(data.projects)) return;
      dropdown.innerHTML = '';
      data.projects.forEach(function(/** @type {{repo: string}} */ p) {
        var item = document.createElement('div');
        item.className = 'px-4 py-3 hover:bg-surface-bright text-on-surface cursor-pointer transition-colors text-sm';
        item.textContent = p.repo;
        item.addEventListener('click', function() { selectRepo(p.repo); });
        dropdown.appendChild(item);
      });
      if (data.projects.length === 1) {
        selectRepo(data.projects[0].repo);
      }
    })
    .catch(function() {});
}

/** @returns {void} */
function initCustomRepoSelect() {
  var trigger = document.getElementById('new-issue-repo-trigger');
  var dropdown = document.getElementById('new-issue-repo-dropdown');
  var chevron = document.getElementById('new-issue-repo-chevron');
  var wrapper = document.getElementById('new-issue-repo-wrapper');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', function() {
    var isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      dropdown.classList.add('hidden');
      if (chevron) chevron.textContent = 'expand_more';
      trigger.classList.remove('border-primary');
    } else {
      dropdown.classList.remove('hidden');
      if (chevron) chevron.textContent = 'expand_less';
      trigger.classList.add('border-primary');
    }
  });

  document.addEventListener('click', function(e) {
    if (wrapper && !wrapper.contains(/** @type {Node} */ (e.target))) {
      dropdown.classList.add('hidden');
      if (chevron) chevron.textContent = 'expand_more';
      trigger.classList.remove('border-primary');
    }
  });
}

/** @returns {void} */
function initNewIssue() {
  initCustomRepoSelect();
  loadNewIssueRepos();
  updateCategoryCardStyles();
  updateFieldLabels();
  updatePreview();

  // Category radio change
  document.querySelectorAll('input[name="new-issue-category"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      updateCategoryCardStyles();
      updateFieldLabels();
      updatePreview();
    });
  });

  // Input change → preview
  ['new-issue-title', 'new-issue-what', 'new-issue-where', 'new-issue-how', 'new-issue-files'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
  });
}

/** @returns {void} */
function submitNewIssue() {
  var cat = getSelectedCategory();
  var title = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-title'));
  var repo = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-repo'));
  var what = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-what'));
  var where = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-where'));
  var how = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('new-issue-how'));
  var files = /** @type {HTMLInputElement|null} */ (document.getElementById('new-issue-files'));
  var btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('new-issue-submit-btn'));
  var resultEl = document.getElementById('new-issue-result');

  var titleVal = title ? title.value.trim() : '';
  var repoVal = repo ? repo.value : '';
  var whatVal = what ? what.value.trim() : '';

  if (!repoVal) {
    if (resultEl) resultEl.innerHTML = '<span class="text-error">저장소를 선택하세요.</span>';
    return;
  }
  if (!titleVal) {
    if (resultEl) resultEl.innerHTML = '<span class="text-error">제목을 입력하세요.</span>';
    return;
  }
  if (!whatVal) {
    if (resultEl) resultEl.innerHTML = '<span class="text-error">내용을 입력하세요.</span>';
    return;
  }

  if (btn) btn.disabled = true;
  if (resultEl) resultEl.innerHTML = '<span class="text-outline text-xs flex items-center gap-1"><span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>발행 중...</span>';

  apiFetch('/api/new-issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: cat,
      title: titleVal,
      repo: repoVal,
      what: whatVal,
      where: where ? where.value : '',
      how: how ? how.value : '',
      files: files ? files.value : '',
    }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (btn) btn.disabled = false;
      if (data.error) {
        if (resultEl) resultEl.innerHTML = '<span class="text-error text-xs">' + escapeHtml(data.error) + '</span>';
        return;
      }
      if (resultEl && data.url) {
        var num = data.number ? '#' + data.number : '';
        resultEl.innerHTML =
          '<span class="text-primary text-xs flex items-center gap-1">' +
          '<span class="material-symbols-outlined text-sm">check_circle</span>' +
          '이슈 ' + escapeHtml(num) + ' 생성됨: ' +
          '<a href="' + escapeHtml(data.url) + '" target="_blank" rel="noopener noreferrer" ' +
          'class="underline hover:text-primary-container">' + escapeHtml(data.url) + '</a>' +
          '</span>';
      }
    })
    .catch(function(err) {
      if (btn) btn.disabled = false;
      if (resultEl) resultEl.innerHTML = '<span class="text-error text-xs">요청 실패: ' + escapeHtml(String(err)) + '</span>';
    });
}
