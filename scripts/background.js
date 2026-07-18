const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

const CONFIG_KEY = 'leetsync_config';
const LEGACY_CONFIG_KEY = 'leethub_config';
const LAST_UPLOAD_KEY = 'leetsync_last_upload';
const LEGACY_LAST_UPLOAD_KEY = 'leethub_last_upload';
const STATS_KEY = 'leetsync_stats';
const LEGACY_STATS_KEY = 'leethub_stats';
const DEFAULT_REPOSITORY = 'leetcode-solutions';
const GITHUB_API_ORIGIN = 'https://api.github.com';
const LEGACY_STORAGE_KEYS = [
  'isSync',
  'leethub_hook',
  'leethub_token',
  'leethub_username',
  'mode_type',
  'pipe_leethub',
  'repo',
  'stats',
];

const LANGUAGE_EXTENSIONS = {
  bash: '.sh',
  c: '.c',
  cpp: '.cpp',
  csharp: '.cs',
  dart: '.dart',
  elixir: '.ex',
  erlang: '.erl',
  go: '.go',
  golang: '.go',
  java: '.java',
  javascript: '.js',
  js: '.js',
  kotlin: '.kt',
  mysql: '.sql',
  mssql: '.sql',
  'ms sql server': '.sql',
  oracle: '.sql',
  oraclesql: '.sql',
  pandas: '.py',
  php: '.php',
  python: '.py',
  python3: '.py',
  racket: '.rkt',
  ruby: '.rb',
  rust: '.rs',
  scala: '.scala',
  swift: '.swift',
  typescript: '.ts',
};

const LANGUAGE_NAMES = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  dart: 'Dart',
  elixir: 'Elixir',
  erlang: 'Erlang',
  go: 'Go',
  golang: 'Go',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  kotlin: 'Kotlin',
  mysql: 'MySQL',
  mssql: 'MS SQL Server',
  oracle: 'Oracle',
  oraclesql: 'Oracle',
  pandas: 'Pandas',
  php: 'PHP',
  python: 'Python',
  python3: 'Python',
  racket: 'Racket',
  ruby: 'Ruby',
  rust: 'Rust',
  scala: 'Scala',
  swift: 'Swift',
  typescript: 'TypeScript',
};

function isValidOwner(owner) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner);
}

function isValidRepository(repository) {
  return /^[A-Za-z0-9._-]+$/.test(repository) && !repository.includes('..');
}

function publicConfig(config) {
  return {
    username: config.username || '',
    repository: config.repository || DEFAULT_REPOSITORY,
    hasToken: Boolean(config.token),
  };
}

function hasStoredToken(config) {
  return Boolean(config && typeof config === 'object' && config.token);
}

async function storageGet(key) {
  return extensionApi.storage.local.get(key);
}

async function storageSet(value) {
  return extensionApi.storage.local.set(value);
}

async function storageRemove(key) {
  return extensionApi.storage.local.remove(key);
}

async function getStoredConfig(includeToken = false) {
  const result = await storageGet([CONFIG_KEY, LEGACY_CONFIG_KEY]);
  let config = result[CONFIG_KEY] || {};

  if (!hasStoredToken(config) && hasStoredToken(result[LEGACY_CONFIG_KEY])) {
    config = result[LEGACY_CONFIG_KEY];
    await storageSet({ [CONFIG_KEY]: config });
    await storageRemove(LEGACY_CONFIG_KEY);
  } else if (hasStoredToken(config) && result[LEGACY_CONFIG_KEY]) {
    await storageRemove(LEGACY_CONFIG_KEY);
  }

  return includeToken ? config : publicConfig(config);
}

function normalizeConfig(input, existingConfig = {}) {
  const username = String(input.username || '').trim();
  const repository = String(input.repository || DEFAULT_REPOSITORY).trim();
  const token = input.token ? String(input.token).trim() : existingConfig.token;

  if (!isValidOwner(username)) {
    throw new Error('Enter a valid GitHub username or organization.');
  }

  if (!isValidRepository(repository)) {
    throw new Error('Enter a valid GitHub repository name.');
  }

  if (!token) {
    throw new Error('Paste a Fine-Grained GitHub token before saving.');
  }

  if (!token.startsWith('github_pat_')) {
    throw new Error('Use a GitHub Fine-Grained token. Classic PATs are not accepted.');
  }

  return {
    username,
    repository,
    token,
  };
}

function cleanSubmission(input) {
  const problemSlug = safeSlug(input.problemSlug || '');
  const title = String(input.problemTitle || '').trim();
  const code = String(input.code || '').trimEnd();
  const language = String(input.language || input.langSlug || '').trim();

  if (!problemSlug) {
    throw new Error('Unable to determine the LeetCode problem slug.');
  }

  if (!title) {
    throw new Error('Unable to determine the LeetCode problem title.');
  }

  if (!code) {
    throw new Error('Unable to extract the accepted source code.');
  }

  if (!language) {
    throw new Error('Unable to determine the programming language.');
  }

  return {
    code,
    descriptionMarkdown: String(input.descriptionMarkdown || '').trim(),
    difficulty: String(input.difficulty || '').trim(),
    examples: String(input.examples || '').trim(),
    language,
    langSlug: String(input.langSlug || language).trim(),
    problemNumber: String(input.problemNumber || '').trim(),
    problemSlug,
    problemTitle: title,
    problemUrl: input.problemUrl || `https://leetcode.com/problems/${problemSlug}/`,
    runtime: String(input.runtime || '').trim(),
    runtimePercentile: input.runtimePercentile,
    memory: String(input.memory || '').trim(),
    memoryPercentile: input.memoryPercentile,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean).map(String) : [],
  };
}

function safeSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
}

function formatDirectoryName(submission) {
  const slug = safeSlug(submission.problemSlug || submission.problemTitle);
  const number = String(submission.problemNumber || '').trim();

  if (/^\d+$/.test(number)) {
    return `${number.padStart(4, '0')}-${slug}`;
  }

  if (number) {
    return `${safeSlug(number)}-${slug}`;
  }

  return slug;
}

function extensionForLanguage(language, langSlug) {
  const candidates = [langSlug, language].map((value) =>
    String(value || '').trim().toLowerCase(),
  );

  for (const candidate of candidates) {
    if (LANGUAGE_EXTENSIONS[candidate]) {
      return LANGUAGE_EXTENSIONS[candidate];
    }
  }

  const compact = candidates.find(Boolean);
  if (compact && LANGUAGE_EXTENSIONS[compact.replace(/[^a-z0-9]/g, '')]) {
    return LANGUAGE_EXTENSIONS[compact.replace(/[^a-z0-9]/g, '')];
  }

  throw new Error(`Unsupported or unknown LeetCode language: ${language || langSlug}`);
}

function languageKey(value) {
  const raw = String(value || '').trim().toLowerCase();

  if (raw === 'c++') {
    return 'cpp';
  }

  if (raw === 'c#') {
    return 'csharp';
  }

  return raw.replace(/[^a-z0-9]+/g, '');
}

function normalizeLanguageName(language, langSlug) {
  const candidates = [langSlug, language];

  for (const candidate of candidates) {
    const key = languageKey(candidate);

    if (LANGUAGE_NAMES[key]) {
      return LANGUAGE_NAMES[key];
    }
  }

  return String(language || langSlug || '').trim();
}

function cleanStatValue(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function formatPercentile(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value.toFixed(2)}%` : '';
  }

  const match = String(value).match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return '';
  }

  const numeric = Number(match[0]);

  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : '';
}

function formatStat(name, value, percentile) {
  const cleanValue = cleanStatValue(value);

  if (!cleanValue) {
    return '';
  }

  const cleanPercentile = formatPercentile(percentile);

  return cleanPercentile
    ? `${name}: ${cleanValue} (${cleanPercentile})`
    : `${name}: ${cleanValue}`;
}

function buildCommitMessage(submission) {
  const stats = [
    formatStat('Runtime', submission.runtime, submission.runtimePercentile),
    formatStat('Memory', submission.memory, submission.memoryPercentile),
  ].filter(Boolean);
  const performance = stats.join(', ');
  const language = normalizeLanguageName(submission.language, submission.langSlug);
  const prefix = [performance, language].filter(Boolean).join(' - ');

  return prefix ? `${prefix} - LeetHub Auto Commit` : 'LeetHub Auto Commit';
}

function encodeGitHubPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function buildReadme(submission) {
  const titlePrefix = submission.problemNumber
    ? `${submission.problemNumber}. `
    : '';
  const description = String(submission.descriptionMarkdown || '').trim();
  const lines = [
    `# ${titlePrefix}${submission.problemTitle}`,
    '',
    submission.difficulty ? `**Difficulty:** ${submission.difficulty}` : '',
    `**LeetCode:** [${submission.problemUrl}](${submission.problemUrl})`,
  ].filter(Boolean);

  if (submission.tags.length > 0) {
    lines.push(`**Tags:** ${submission.tags.join(', ')}`);
  }

  lines.push('', '## Problem', '');
  lines.push(
    description ||
      `The full problem statement is available on [LeetCode](${submission.problemUrl}).`,
  );

  return `${lines.join('\n')}\n`;
}

function githubError(response, body) {
  const remaining = response.headers.get('x-ratelimit-remaining');

  if (response.status === 401) {
    return new Error('GitHub rejected the token. Check that it is a valid Fine-Grained token.');
  }

  if (response.status === 403 && remaining === '0') {
    return new Error('GitHub API rate limit reached. Try again after the reset window.');
  }

  if (response.status === 403) {
    return new Error('GitHub refused the request. Check repository Contents read/write permission.');
  }

  if (response.status === 404) {
    return new Error('Repository not found, or this token is not allowed to access it.');
  }

  if (response.status === 409) {
    return new Error('GitHub reported a file conflict. Sync again to retry with the latest file version.');
  }

  if (response.status === 422) {
    return new Error('GitHub rejected the upload payload. Check the repository and branch state.');
  }

  const message = body && body.message ? ` GitHub says: ${body.message}` : '';
  return new Error(`GitHub API request failed with HTTP ${response.status}.${message}`);
}

async function githubRequest(config, path, options = {}, allowedStatuses = [200]) {
  const url = `${GITHUB_API_ORIGIN}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: options.body,
  });
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = null;
    }
  }

  if (!allowedStatuses.includes(response.status)) {
    throw githubError(response, body);
  }

  return {
    body,
    headers: response.headers,
    status: response.status,
  };
}

async function saveConfig(inputConfig) {
  const existing = await getStoredConfig(true);
  const config = normalizeConfig(inputConfig, existing);

  await storageSet({ [CONFIG_KEY]: config });
  await storageRemove(LEGACY_CONFIG_KEY);

  return {
    ok: true,
    config: publicConfig(config),
  };
}

async function testGitHubConnection() {
  const config = normalizeConfig(await getStoredConfig(true));
  const repoPath = `/repos/${encodeURIComponent(config.username)}/${encodeURIComponent(config.repository)}`;
  const repo = await githubRequest(config, repoPath, {}, [200]);
  const fullName = `${config.username}/${config.repository}`.toLowerCase();

  if (!repo.body || String(repo.body.full_name || '').toLowerCase() !== fullName) {
    throw new Error('GitHub returned a different repository than the saved configuration.');
  }

  await githubRequest(config, `${repoPath}/contents`, {}, [200, 404]);

  const permissions = repo.body.permissions || {};

  return {
    ok: true,
    repository: repo.body.full_name,
    writeAccessConfirmed: Boolean(
      permissions.admin || permissions.maintain || permissions.push,
    ),
  };
}

async function getExistingFileSha(config, path) {
  const repoPath = `/repos/${encodeURIComponent(config.username)}/${encodeURIComponent(config.repository)}`;
  const response = await githubRequest(
    config,
    `${repoPath}/contents/${encodeGitHubPath(path)}`,
    {},
    [200, 404],
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.body || response.body.type !== 'file') {
    throw new Error(`${path} already exists in GitHub, but it is not a file.`);
  }

  return response.body.sha;
}

async function putRepositoryFile(config, path, content, message) {
  const repoPath = `/repos/${encodeURIComponent(config.username)}/${encodeURIComponent(config.repository)}`;
  const sha = await getExistingFileSha(config, path);
  const payload = {
    message,
    content: utf8ToBase64(content),
  };

  if (sha) {
    payload.sha = sha;
  }

  const response = await githubRequest(
    config,
    `${repoPath}/contents/${encodeGitHubPath(path)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    [200, 201],
  );

  return {
    action: response.status === 201 ? 'created' : 'updated',
    path,
    sha: response.body && response.body.content ? response.body.content.sha : null,
  };
}

async function updateStats(submission, directory, solutionAction) {
  const result = await storageGet([STATS_KEY, LEGACY_STATS_KEY]);
  const stats = result[STATS_KEY] || result[LEGACY_STATS_KEY] || {
    easy: 0,
    hard: 0,
    medium: 0,
    problems: {},
    solved: 0,
  };

  if (!stats.problems[directory] && solutionAction === 'created') {
    stats.problems[directory] = true;
    stats.solved += 1;

    const difficulty = submission.difficulty.toLowerCase();
    if (difficulty === 'easy') {
      stats.easy += 1;
    } else if (difficulty === 'medium') {
      stats.medium += 1;
    } else if (difficulty === 'hard') {
      stats.hard += 1;
    }
  }

  await storageSet({ [STATS_KEY]: stats });
  await storageRemove(LEGACY_STATS_KEY);
}

async function uploadSubmission(inputSubmission) {
  const config = normalizeConfig(await getStoredConfig(true));
  const submission = cleanSubmission(inputSubmission);
  const directory = formatDirectoryName(submission);
  const extension = extensionForLanguage(submission.language, submission.langSlug);
  const solutionFilename = `solution${extension}`;
  const readmePath = `${directory}/README.md`;
  const solutionPath = `${directory}/${solutionFilename}`;
  const readme = buildReadme(submission);
  const commitMessage = buildCommitMessage(submission);

  const readmeResult = await putRepositoryFile(
    config,
    readmePath,
    readme,
    commitMessage,
  );
  const solutionResult = await putRepositoryFile(
    config,
    solutionPath,
    `${submission.code}\n`,
    commitMessage,
  );

  await updateStats(submission, directory, solutionResult.action);

  const lastUpload = {
    at: new Date().toISOString(),
    files: [readmeResult, solutionResult],
    message: `${solutionResult.action} ${solutionPath}`,
    problemSlug: submission.problemSlug,
    repository: `${config.username}/${config.repository}`,
  };
  await storageSet({ [LAST_UPLOAD_KEY]: lastUpload });

  return {
    ok: true,
    files: [readmeResult, solutionResult],
    message: `Synced ${solutionPath} to ${config.username}/${config.repository}.`,
  };
}

async function getPublicState() {
  const [config, result] = await Promise.all([
    getStoredConfig(false),
    storageGet([LAST_UPLOAD_KEY, LEGACY_LAST_UPLOAD_KEY]),
  ]);
  const lastUpload = result[LAST_UPLOAD_KEY] || result[LEGACY_LAST_UPLOAD_KEY] || null;

  if (!result[LAST_UPLOAD_KEY] && result[LEGACY_LAST_UPLOAD_KEY]) {
    await storageSet({ [LAST_UPLOAD_KEY]: result[LEGACY_LAST_UPLOAD_KEY] });
    await storageRemove(LEGACY_LAST_UPLOAD_KEY);
  }

  return {
    ok: true,
    config,
    lastUpload,
  };
}

async function migrateLegacyStorage() {
  const result = await storageGet([
    CONFIG_KEY,
    LEGACY_CONFIG_KEY,
    LAST_UPLOAD_KEY,
    LEGACY_LAST_UPLOAD_KEY,
    STATS_KEY,
    LEGACY_STATS_KEY,
  ]);
  const updates = {};
  const removals = [...LEGACY_STORAGE_KEYS];

  if (!hasStoredToken(result[CONFIG_KEY]) && hasStoredToken(result[LEGACY_CONFIG_KEY])) {
    updates[CONFIG_KEY] = result[LEGACY_CONFIG_KEY];
    removals.push(LEGACY_CONFIG_KEY);
  } else if (hasStoredToken(result[CONFIG_KEY]) && result[LEGACY_CONFIG_KEY]) {
    removals.push(LEGACY_CONFIG_KEY);
  }

  if (!result[LAST_UPLOAD_KEY] && result[LEGACY_LAST_UPLOAD_KEY]) {
    updates[LAST_UPLOAD_KEY] = result[LEGACY_LAST_UPLOAD_KEY];
    removals.push(LEGACY_LAST_UPLOAD_KEY);
  } else if (result[LAST_UPLOAD_KEY] && result[LEGACY_LAST_UPLOAD_KEY]) {
    removals.push(LEGACY_LAST_UPLOAD_KEY);
  }

  if (!result[STATS_KEY] && result[LEGACY_STATS_KEY]) {
    updates[STATS_KEY] = result[LEGACY_STATS_KEY];
    removals.push(LEGACY_STATS_KEY);
  } else if (result[STATS_KEY] && result[LEGACY_STATS_KEY]) {
    removals.push(LEGACY_STATS_KEY);
  }

  if (Object.keys(updates).length > 0) {
    await storageSet(updates);
  }

  await storageRemove(removals);
}

function safeResponse(promise) {
  return promise.catch((error) => ({
    ok: false,
    error: error.message || 'Unexpected extension error.',
  }));
}

extensionApi.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) {
    return false;
  }

  switch (message.type) {
    case 'LEETSYNC_GET_PUBLIC_STATE':
      return safeResponse(getPublicState());
    case 'LEETSYNC_SAVE_CONFIG':
      return safeResponse(saveConfig(message.config || {}));
    case 'LEETSYNC_TEST_GITHUB':
      return safeResponse(testGitHubConnection());
    case 'LEETSYNC_UPLOAD_SUBMISSION':
      return safeResponse(uploadSubmission(message.submission || {}));
    default:
      return false;
  }
});

extensionApi.runtime.onInstalled.addListener(() => {
  migrateLegacyStorage().catch(() => {});
});
