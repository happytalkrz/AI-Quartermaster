// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   EmptyState Renderer — Kinetic Command Design System
   ══════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} PrimaryAction
 * @property {string} label - Button label
 * @property {string} onclick - Inline onclick handler
 */

/**
 * @typedef {Object} SecondaryLink
 * @property {string} label - Link label
 * @property {string} href - Link href
 */

/**
 * @typedef {Object} EmptyStateOptions
 * @property {string} icon - Material Symbol icon name
 * @property {string} title - Main title text
 * @property {string} description - Description text
 * @property {PrimaryAction=} primaryAction - CTA button (optional)
 * @property {SecondaryLink=} secondaryLink - Secondary link (optional)
 */

/**
 * Renders a common EmptyState card following the Kinetic Command design system.
 * - surface_container_high background card
 * - primary 60% opacity 72px Material Symbol icon
 * - primary gradient CTA button
 *
 * @param {EmptyStateOptions} opts
 * @returns {string} HTML string
 */
function renderEmptyState(opts) {
  var primaryBtn = '';
  if (opts.primaryAction) {
    primaryBtn =
      '<button onclick="' + esc(opts.primaryAction.onclick) + '" ' +
        'class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold font-headline ' +
        'bg-gradient-to-r from-primary to-primary-container text-on-primary ' +
        'hover:opacity-90 active:scale-95 transition-all">' +
        esc(opts.primaryAction.label) +
      '</button>';
  }

  var secondaryLnk = '';
  if (opts.secondaryLink) {
    secondaryLnk =
      '<a href="' + esc(opts.secondaryLink.href) + '" ' +
        'class="mt-3 text-xs text-primary/70 hover:text-primary transition-colors underline underline-offset-2">' +
        esc(opts.secondaryLink.label) +
      '</a>';
  }

  return (
    '<div class="flex flex-col items-center justify-center py-16 px-6 ' +
      'bg-surface-container-high rounded-xl ring-1 ring-outline-variant/10">' +
      '<span class="material-symbols-outlined text-[72px] leading-none text-primary/60 mb-4" ' +
        'style="font-variation-settings: \'FILL\' 0, \'wght\' 300, \'GRAD\' 0, \'opsz\' 48;">' +
        esc(opts.icon) +
      '</span>' +
      '<p class="text-base font-bold font-headline text-on-surface mb-2">' +
        esc(opts.title) +
      '</p>' +
      '<p class="text-sm text-outline text-center max-w-xs leading-relaxed">' +
        esc(opts.description) +
      '</p>' +
      primaryBtn +
      secondaryLnk +
    '</div>'
  );
}
