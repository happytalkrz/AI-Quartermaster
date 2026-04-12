// @ts-check
'use strict';

/* ══════════════════════════════════════════════════════════════
   API Key Management
   ══════════════════════════════════════════════════════════════ */
var API_KEY_STORAGE = 'aqm-api-key';

/**
 * @returns {string}
 */
function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

/**
 * @param {string} key
 * @returns {void}
 */
function setApiKey(key) {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
}

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
function apiFetch(url, opts) {
  var key = getApiKey();
  var headers = /** @type {Record<string, string>} */ (Object.assign({}, opts && opts.headers));
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return fetch(url, Object.assign({}, opts, { headers: headers })).then(function(r) {
    if (r.status === 401) {
      showApiKeyPrompt();
      return Promise.reject(new Error('Unauthorized'));
    }
    return r;
  });
}

/** @returns {void} */
function showApiKeyPrompt() {
  var banner = document.getElementById('api-key-banner');
  if (banner) banner.style.display = 'flex';
}

/** @returns {void} */
function hideApiKeyPrompt() {
  var banner = document.getElementById('api-key-banner');
  if (banner) banner.style.display = 'none';
}

/**
 * @param {string} endpoint
 * @param {Record<string, string | number | boolean | null | undefined>} [additionalParams]
 * @returns {string}
 */
function buildApiUrl(endpoint, additionalParams) {
  var url = endpoint;
  /** @type {string[]} */
  var params = [];

  if (currentProject && currentProject !== 'all') {
    params.push('project=' + encodeURIComponent(currentProject));
  }

  if (additionalParams) {
    for (var key in additionalParams) {
      if (additionalParams.hasOwnProperty(key) && additionalParams[key] !== null && additionalParams[key] !== undefined) {
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(/** @type {string | number | boolean} */ (additionalParams[key])));
      }
    }
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  return url;
}

/**
 * @param {Record<string, string | number | boolean | null | undefined>} [additionalParams]
 * @returns {string}
 */
function buildJobsUrl(additionalParams) {
  return buildApiUrl('/api/jobs', additionalParams);
}

/**
 * @param {Record<string, string | number | boolean | null | undefined>} [additionalParams]
 * @returns {string}
 */
function buildStatsUrl(additionalParams) {
  return buildApiUrl('/api/stats', additionalParams);
}

/** @returns {void} */
function saveApiKey() {
  var input = /** @type {HTMLInputElement} */ (document.getElementById('api-key-input'));
  setApiKey(input.value.trim());
  hideApiKeyPrompt();
  connectSSE();
  apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData).catch(function() {});
}
