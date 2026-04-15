// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   EmptyState Component
   ══════════════════════════════════════════════════════════════ */

/** @typedef {'SKIP_EVENTS'|'JOBS_EMPTY'|'KANBAN_EMPTY_COLUMN'|'LOGS_EMPTY'|'PROJECTS_UNREGISTERED'|'NOTIFICATIONS_EMPTY'} EmptyStateVariant */

/**
 * @typedef {{ buttonOnclick?: string, linkOnclick?: string }} EmptyStateOpts
 */

/**
 * @type {Record<EmptyStateVariant, { icon: string, i18nPrefix: string, hasButton: boolean, hasLink: boolean }>}
 */
var EMPTY_STATE_CONFIGS = {
  SKIP_EVENTS:            { icon: 'filter_alt_off',   i18nPrefix: 'emptyState.skipEvents',            hasButton: true,  hasLink: true  },
  JOBS_EMPTY:             { icon: 'inbox',             i18nPrefix: 'emptyState.jobsEmpty',             hasButton: true,  hasLink: true  },
  KANBAN_EMPTY_COLUMN:    { icon: 'view_column',       i18nPrefix: 'emptyState.kanbanEmptyColumn',     hasButton: false, hasLink: true  },
  LOGS_EMPTY:             { icon: 'article',           i18nPrefix: 'emptyState.logsEmpty',             hasButton: true,  hasLink: false },
  PROJECTS_UNREGISTERED:  { icon: 'rocket_launch',     i18nPrefix: 'emptyState.projectsUnregistered',  hasButton: true,  hasLink: false },
  NOTIFICATIONS_EMPTY:    { icon: 'notifications_off', i18nPrefix: 'emptyState.notificationsEmpty',    hasButton: false, hasLink: true  },
};

/**
 * @param {EmptyStateVariant} variant
 * @param {EmptyStateOpts} [opts]
 * @returns {string}
 */
function renderEmptyState(variant, opts) {
  var cfg = EMPTY_STATE_CONFIGS[variant];
  var o = opts || {};

  var iconHtml = '<span class="material-symbols-outlined text-[72px] text-primary/60 mb-8 transition-transform group-hover:scale-110 duration-500">' + cfg.icon + '</span>';
  var titleHtml = '<h3 class="text-xl font-headline font-semibold text-on-surface mb-3">' + esc(t(cfg.i18nPrefix + '.title')) + '</h3>';
  var descHtml = '<p class="text-secondary-fixed-dim font-headline text-sm mb-10 leading-relaxed px-4">' + esc(t(cfg.i18nPrefix + '.description')) + '</p>';

  var ctaHtml = '';
  if (cfg.hasButton) {
    var btnOnclick = o.buttonOnclick ? ' onclick="' + o.buttonOnclick + '"' : '';
    ctaHtml += '<button class="w-full kinetic-gradient text-on-primary font-bold py-3 px-6 rounded-lg text-sm mb-4 active:scale-95 transition-all"' + btnOnclick + '>' + esc(t(cfg.i18nPrefix + '.buttonLabel')) + '</button>';
  } else {
    ctaHtml += '<div class="h-11"></div>';
  }

  if (cfg.hasLink) {
    var linkOnclick = o.linkOnclick ? ' onclick="' + o.linkOnclick + '"' : '';
    ctaHtml += '<a class="text-primary/70 hover:text-primary text-xs font-medium transition-colors mt-auto" href="#"' + linkOnclick + '>' + esc(t(cfg.i18nPrefix + '.linkLabel')) + '</a>';
  } else {
    ctaHtml += '<div class="h-4"></div>';
  }

  return (
    '<div class="bg-surface-container-high rounded-xl p-10 flex flex-col items-center text-center group transition-all duration-300 hover:bg-surface-container-highest">' +
      iconHtml + titleHtml + descHtml + ctaHtml +
    '</div>'
  );
}
