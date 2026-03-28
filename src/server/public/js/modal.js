'use strict';

/* ══════════════════════════════════════════════════════════════
   Confirm Modal
   ══════════════════════════════════════════════════════════════ */
var confirmResolve = null;

function showConfirm(title, desc) {
  return new Promise(function(resolve) {
    confirmResolve = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-desc').textContent = desc;
    var modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  });
}

function closeConfirm(result) {
  var modal = document.getElementById('confirm-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
