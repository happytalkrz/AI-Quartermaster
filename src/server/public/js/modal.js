// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   Confirm Modal
   ══════════════════════════════════════════════════════════════ */
/** @type {((value: boolean) => void) | null} */
var confirmResolve = null;

/**
 * @param {string} title
 * @param {string} desc
 * @returns {Promise<boolean>}
 */
function showConfirm(title, desc) {
  return new Promise(function(resolve) {
    confirmResolve = resolve;
    var titleEl = /** @type {HTMLElement} */ (document.getElementById('confirm-title'));
    titleEl.textContent = title;
    var descEl = /** @type {HTMLElement} */ (document.getElementById('confirm-desc'));
    descEl.textContent = desc;
    var modal = /** @type {HTMLElement} */ (document.getElementById('confirm-modal'));
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  });
}

/**
 * @param {boolean} result
 * @returns {void}
 */
function closeConfirm(result) {
  var modal = /** @type {HTMLElement} */ (document.getElementById('confirm-modal'));
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
