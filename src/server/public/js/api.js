'use strict';

/* ══════════════════════════════════════════════════════════════
   API Key Management
   ══════════════════════════════════════════════════════════════ */
var API_KEY_STORAGE = 'aqm-api-key';

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

function setApiKey(key) {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
}

function apiFetch(url, opts) {
  var key = getApiKey();
  var headers = Object.assign({}, opts && opts.headers);
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return fetch(url, Object.assign({}, opts, { headers: headers })).then(function(r) {
    if (r.status === 401) {
      showApiKeyPrompt();
      return Promise.reject(new Error('Unauthorized'));
    }
    return r;
  });
}

function showApiKeyPrompt() {
  document.getElementById('api-key-banner').style.display = 'flex';
}

function hideApiKeyPrompt() {
  document.getElementById('api-key-banner').style.display = 'none';
}

function buildApiUrl(endpoint, additionalParams) {
  var url = endpoint;
  var params = [];

  if (currentProject && currentProject !== 'all') {
    params.push('project=' + encodeURIComponent(currentProject));
  }

  if (additionalParams) {
    for (var key in additionalParams) {
      if (additionalParams.hasOwnProperty(key) && additionalParams[key] !== null && additionalParams[key] !== undefined) {
        params.push(encodeURIComponent(key) + '=' + encodeURIComponent(additionalParams[key]));
      }
    }
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  return url;
}

function buildJobsUrl(additionalParams) {
  return buildApiUrl('/api/jobs', additionalParams);
}

function buildStatsUrl(additionalParams) {
  return buildApiUrl('/api/stats', additionalParams);
}

function saveApiKey() {
  var input = document.getElementById('api-key-input');
  setApiKey(input.value.trim());
  hideApiKeyPrompt();
  connectSSE();
  apiFetch(buildJobsUrl()).then(function(r) { return r.json(); }).then(handleData).catch(function() {});
}

function updateJobPriority(jobId, newIndex) {
  // Calculate priority based on position
  var priority = calculatePriorityFromIndex(newIndex);

  apiFetch('/api/jobs/' + encodeURIComponent(jobId) + '/priority', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: priority })
  }).then(function(response) {
    if (!response.ok) {
      console.error('Failed to update priority:', response.status);
      // Revert optimistic update on failure
      if (typeof connectSSE === 'function') {
        connectSSE(); // Refresh data
      }
      return;
    }
    return response.json();
  }).then(function(data) {
    if (data) {
      console.log('Priority updated successfully:', data);
    }
  }).catch(function(error) {
    console.error('Error updating priority:', error);
    // Revert optimistic update on error
    if (typeof connectSSE === 'function') {
      connectSSE(); // Refresh data
    }
  });
}

function calculatePriorityFromIndex(index) {
  // Map position to priority levels
  // Top positions get high priority, middle gets normal, bottom gets low
  if (index < 3) {
    return 'high';
  } else if (index < 7) {
    return 'normal';
  } else {
    return 'low';
  }
}
