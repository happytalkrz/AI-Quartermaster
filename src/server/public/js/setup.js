// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Setup Wizard — Step 1: GitHub Token
   ══════════════════════════════════════════════════════════════ */

/** @type {() => void} */
var validateGitHubToken;

/** @type {ReturnType<typeof setTimeout> | null} */
var _setupDebounceTimer = null;

/** @type {boolean} */
var _setupListenerAttached = false;

/** @returns {void} */
function initSetupView() {
  if (_setupListenerAttached) return;
  var tokenInputEl = document.getElementById('setup-github-token');
  if (!tokenInputEl) return;
  var tokenInput = /** @type {HTMLInputElement} */ (tokenInputEl);

  _setupListenerAttached = true;

  tokenInput.addEventListener('input', function () {
    if (_setupDebounceTimer !== null) {
      clearTimeout(_setupDebounceTimer);
      _setupDebounceTimer = null;
    }
    var val = tokenInput.value.trim();
    if (!val) return;
    _setupDebounceTimer = setTimeout(function () {
      _setupDebounceTimer = null;
      validateGitHubToken();
    }, 600);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initSetupView();
});
