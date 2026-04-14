// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Setup Wizard — Step 1: GitHub Token
   ══════════════════════════════════════════════════════════════ */

/** @type {ReturnType<typeof setTimeout> | null} */
var _setupDebounceTimer = null;

/** @type {boolean} */
var _setupListenerAttached = false;

/** @returns {void} */
function initSetupView() {
  if (_setupListenerAttached) return;
  var tokenInput = /** @type {HTMLInputElement|null} */ (document.getElementById('setup-github-token'));
  if (!tokenInput) return;

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
