const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

const form = document.getElementById('config-form');
const usernameInput = document.getElementById('username');
const repositoryInput = document.getElementById('repository');
const tokenInput = document.getElementById('token');
const saveButton = document.getElementById('save-button');
const testButton = document.getElementById('test-button');
const manualSyncButton = document.getElementById('manual-sync-button');
const statusMessage = document.getElementById('status-message');
const repoLink = document.getElementById('repo-link');
const lastSync = document.getElementById('last-sync');

let storedConfig = null;
let activeProgressRequestId = null;

function setBusy(isBusy) {
  saveButton.disabled = isBusy;
  testButton.disabled = isBusy;
  manualSyncButton.disabled = isBusy;
}

function setStatus(message, tone = 'warn') {
  statusMessage.className = `status-${tone}`;
  statusMessage.textContent = message;
}

function normalizeField(value) {
  return value.trim();
}

function validateTokenForSave(token, hasExistingToken) {
  if (!token && hasExistingToken) {
    return;
  }

  if (!token) {
    throw new Error('Paste a Fine-Grained GitHub token before saving.');
  }

  if (!token.startsWith('github_pat_')) {
    throw new Error('Use a GitHub Fine-Grained token. Classic PATs are not accepted.');
  }
}

function readConfigFromForm() {
  const username = normalizeField(usernameInput.value);
  const repository = normalizeField(repositoryInput.value || 'leetcode-solutions');
  const nextToken = tokenInput.value.trim();
  const hasExistingToken = Boolean(storedConfig && storedConfig.hasToken);

  validateTokenForSave(nextToken, hasExistingToken);

  return {
    username,
    repository,
    token: nextToken || undefined,
  };
}

async function sendMessage(message) {
  return extensionApi.runtime.sendMessage(message);
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isLeetCodeProblemUrl(url) {
  return /^https:\/\/leetcode\.com\/problems\/[^/]+\/?/.test(String(url || ''));
}

async function loadState() {
  const response = await sendMessage({ type: 'LEETSYNC_GET_PUBLIC_STATE' });

  storedConfig = response.config;

  usernameInput.value = storedConfig.username || '';
  repositoryInput.value = storedConfig.repository || 'leetcode-solutions';
  tokenInput.value = '';
  tokenInput.placeholder = storedConfig.hasToken
    ? 'Stored token will be kept if left blank'
    : 'Paste token to save or replace';

  repoLink.textContent = '';
  if (storedConfig.username && storedConfig.repository) {
    const link = document.createElement('a');
    link.href = `https://github.com/${storedConfig.username}/${storedConfig.repository}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${storedConfig.username}/${storedConfig.repository}`;
    repoLink.append('Repository: ', link);
  }

  if (response.lastUpload && response.lastUpload.message) {
    lastSync.textContent = `Last sync: ${response.lastUpload.message}`;
  } else {
    lastSync.textContent = '';
  }

  if (storedConfig.hasToken && storedConfig.username && storedConfig.repository) {
    setStatus('Configuration saved locally.', 'ok');
  } else {
    setStatus('Add your GitHub username, repository, and Fine-Grained token.', 'warn');
  }
}

async function saveConfig() {
  const config = readConfigFromForm();
  const response = await sendMessage({
    type: 'LEETSYNC_SAVE_CONFIG',
    config,
  });

  if (!response.ok) {
    throw new Error(response.error || 'Unable to save configuration.');
  }

  await loadState();
  setStatus('Configuration saved locally.', 'ok');
}

async function testConnection() {
  await saveConfig();
  const response = await sendMessage({ type: 'LEETSYNC_TEST_GITHUB' });

  if (!response.ok) {
    throw new Error(response.error || 'GitHub connection test failed.');
  }

  const suffix = response.writeAccessConfirmed
    ? ' Contents write access is available.'
    : ' Upload permissions will be confirmed on the first sync.';

  setStatus(`GitHub connection works.${suffix}`, 'ok');
}

async function manualSync() {
  await saveConfig();
  setStatus('Finding latest Accepted submission...', 'warn');

  const tabs = await extensionApi.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeTab = tabs && tabs[0];

  if (!activeTab || activeTab.id === undefined) {
    throw new Error('Open an accepted LeetCode problem tab, then try again.');
  }

  if (activeTab.url && !isLeetCodeProblemUrl(activeTab.url)) {
    throw new Error('Open a LeetCode problem page, then try manual sync again.');
  }

  const requestId = createRequestId();
  activeProgressRequestId = requestId;

  let response = null;

  try {
    response = await extensionApi.tabs.sendMessage(activeTab.id, {
      requestId,
      type: 'LEETSYNC_SYNC_CURRENT_ACCEPTED',
    });
  } catch (error) {
    throw new Error('Open a LeetCode problem page, then try manual sync again.');
  } finally {
    activeProgressRequestId = null;
  }

  if (!response || !response.ok) {
    throw new Error((response && response.error) || 'Manual sync failed.');
  }

  await loadState();
  setStatus(response.message || 'Accepted solution synced.', 'ok');
}

extensionApi.runtime.onMessage.addListener((message) => {
  if (
    !message ||
    message.type !== 'LEETSYNC_MANUAL_SYNC_PROGRESS' ||
    message.requestId !== activeProgressRequestId
  ) {
    return false;
  }

  setStatus(message.message || 'Syncing accepted solution...', 'warn');
  return false;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(true);

  try {
    await saveConfig();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

testButton.addEventListener('click', async () => {
  setBusy(true);

  try {
    await testConnection();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

manualSyncButton.addEventListener('click', async () => {
  setBusy(true);

  try {
    await manualSync();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

loadState().catch((error) => {
  setStatus(error.message || 'Unable to load configuration.', 'error');
});
