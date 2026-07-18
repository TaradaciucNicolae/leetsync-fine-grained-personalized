const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

const ACCEPTED_EVENT = 'LEETSYNC_FINE_GRAINED_ACCEPTED';
const EDITOR_REQUEST_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_REQUEST';
const EDITOR_RESPONSE_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_RESPONSE';
const PAGE_STATUS_ID = 'leetsync-fine-grained-status';
const RECENT_SUBMIT_WINDOW_MS = 180000;

const LANGUAGE_ALIASES = {
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
  python3: 'Python3',
  racket: 'Racket',
  ruby: 'Ruby',
  rust: 'Rust',
  scala: 'Scala',
  swift: 'Swift',
  typescript: 'TypeScript',
};

const KNOWN_LANGUAGE_LABELS = new Set(Object.values(LANGUAGE_ALIASES));
const MANUAL_SUBMISSION_PAGE_LIMIT = 20;
const MANUAL_SUBMISSION_MAX_PAGES = 10;

let lastSubmitAt = 0;
let lastSyncedFingerprint = '';
let autoSyncTimer = null;
let syncInFlight = false;

function installPageBridge() {
  const script = document.createElement('script');
  script.src = extensionApi.runtime.getURL('scripts/leetcode-page-bridge.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
}

function getProblemSlug() {
  const match = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return match ? match[1] : '';
}

function isProblemPage() {
  return Boolean(getProblemSlug());
}

async function fetchLeetCodeGraphQL(operationName, query, variables) {
  const headers = {
    'Content-Type': 'application/json',
  };

  const response = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      operationName,
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode GraphQL request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();

  if (body.errors && body.errors.length > 0) {
    throw new Error('LeetCode returned an error while loading problem data.');
  }

  return body.data || {};
}

async function fetchQuestionData(problemSlug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        content
        difficulty
        topicTags {
          name
          slug
        }
      }
    }
  `;
  const data = await fetchLeetCodeGraphQL('questionData', query, {
    titleSlug: problemSlug,
  });

  return data.question || null;
}

async function fetchSubmissionDetails(submissionId) {
  const numericId = Number(submissionId);

  if (!Number.isFinite(numericId) || numericId <= 0) {
    return null;
  }

  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        lang
        runtime
        runtimeDisplay
        memory
        memoryDisplay
        statusDisplay
        question {
          questionFrontendId
          title
          titleSlug
          content
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    }
  `;
  const data = await fetchLeetCodeGraphQL('submissionDetails', query, {
    submissionId: numericId,
  });

  return data.submissionDetails || null;
}

async function fetchLeetCodeUserStatus() {
  const query = `
    query globalData {
      userStatus {
        isSignedIn
        username
      }
    }
  `;
  const data = await fetchLeetCodeGraphQL('globalData', query, {});

  return data.userStatus || null;
}

async function fetchQuestionSubmissionList(problemSlug, offset, limit, lastKey) {
  const query = `
    query questionSubmissionList(
      $offset: Int!
      $limit: Int!
      $lastKey: String
      $questionSlug: String!
    ) {
      questionSubmissionList(
        offset: $offset
        limit: $limit
        lastKey: $lastKey
        questionSlug: $questionSlug
      ) {
        lastKey
        hasNext
        submissions {
          id
          title
          titleSlug
          status
          statusDisplay
          lang
          langName
          runtime
          memory
          timestamp
          url
          isPending
        }
      }
    }
  `;
  const data = await fetchLeetCodeGraphQL('questionSubmissionList', query, {
    lastKey,
    limit,
    offset,
    questionSlug: problemSlug,
  });

  return data.questionSubmissionList || null;
}

function isAcceptedSubmission(submission) {
  const statusValues = [
    submission && submission.status,
    submission && submission.statusDisplay,
  ];

  return statusValues.some(
    (value) => String(value || '').trim().toLowerCase() === 'accepted',
  );
}

async function findLatestAcceptedSubmissionRecord(problemSlug) {
  let userStatus = null;

  try {
    userStatus = await fetchLeetCodeUserStatus();
  } catch (error) {
    throw new Error('Unable to confirm your LeetCode login state.');
  }

  if (!userStatus || userStatus.isSignedIn !== true) {
    throw new Error('Sign in to LeetCode, then try manual sync again.');
  }

  let offset = 0;
  let lastKey = null;
  let sawAnySubmission = false;

  for (let page = 0; page < MANUAL_SUBMISSION_MAX_PAGES; page += 1) {
    let submissionPage = null;

    try {
      submissionPage = await fetchQuestionSubmissionList(
        problemSlug,
        offset,
        MANUAL_SUBMISSION_PAGE_LIMIT,
        lastKey,
      );
    } catch (error) {
      throw new Error('Unable to retrieve your LeetCode submission history.');
    }

    if (!submissionPage || !Array.isArray(submissionPage.submissions)) {
      throw new Error('Unable to retrieve your LeetCode submission history.');
    }

    if (submissionPage.submissions.length > 0) {
      sawAnySubmission = true;
    }

    const acceptedSubmission = submissionPage.submissions.find(
      (submission) =>
        isAcceptedSubmission(submission) &&
        String(submission.titleSlug || problemSlug) === problemSlug,
    );

    if (acceptedSubmission) {
      return acceptedSubmission;
    }

    if (!submissionPage.hasNext || submissionPage.submissions.length === 0) {
      break;
    }

    offset += MANUAL_SUBMISSION_PAGE_LIMIT;
    lastKey = submissionPage.lastKey || null;
  }

  if (!sawAnySubmission) {
    throw new Error('No LeetCode submissions were found for this problem.');
  }

  throw new Error('This problem has no Accepted submission for your LeetCode account.');
}

async function getLatestAcceptedSubmissionDetail(problemSlug) {
  const acceptedRecord = await findLatestAcceptedSubmissionRecord(problemSlug);
  const submissionId = acceptedRecord.id;
  let submissionDetails = null;

  try {
    submissionDetails = await fetchSubmissionDetails(submissionId);
  } catch (error) {
    throw new Error('Unable to retrieve the accepted submission source code.');
  }

  if (!submissionDetails) {
    throw new Error('Unable to retrieve the accepted submission source code.');
  }

  if (
    submissionDetails.statusDisplay &&
    String(submissionDetails.statusDisplay).trim().toLowerCase() !== 'accepted'
  ) {
    throw new Error('The latest matching LeetCode submission was not Accepted.');
  }

  if (
    submissionDetails.question &&
    submissionDetails.question.titleSlug &&
    submissionDetails.question.titleSlug !== problemSlug
  ) {
    throw new Error('LeetCode returned submission details for a different problem.');
  }

  if (!String(submissionDetails.code || '').trim()) {
    throw new Error('Unable to retrieve the accepted submission source code.');
  }

  return {
    code: submissionDetails.code,
    lang: firstNonEmpty(
      submissionDetails.lang,
      acceptedRecord.langName,
      acceptedRecord.lang,
    ),
    langSlug: firstNonEmpty(acceptedRecord.lang, submissionDetails.lang),
    memory: firstNonEmpty(
      submissionDetails.memoryDisplay,
      submissionDetails.memory,
      acceptedRecord.memory,
    ),
    runtime: firstNonEmpty(
      submissionDetails.runtimeDisplay,
      submissionDetails.runtime,
      acceptedRecord.runtime,
    ),
    submissionDetails,
    submissionId,
  };
}

function requestEditorSnapshot() {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener(EDITOR_RESPONSE_EVENT, handleResponse);
      resolve({ code: '', language: '' });
    }, 1200);

    function handleResponse(event) {
      const detail = event.detail || {};

      if (detail.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener(EDITOR_RESPONSE_EVENT, handleResponse);
      resolve({
        code: detail.code || '',
        language: detail.language || '',
      });
    }

    window.addEventListener(EDITOR_RESPONSE_EVENT, handleResponse);
    window.dispatchEvent(
      new CustomEvent(EDITOR_REQUEST_EVENT, {
        detail: { requestId },
      }),
    );
  });
}

function normalizeLanguageLabel(value) {
  const raw = String(value || '').trim();
  const compact = raw.toLowerCase().replace(/[^a-z0-9#+ ]/g, '');
  const noSpace = compact.replace(/\s+/g, '');

  if (LANGUAGE_ALIASES[compact]) {
    return LANGUAGE_ALIASES[compact];
  }

  if (LANGUAGE_ALIASES[noSpace]) {
    return LANGUAGE_ALIASES[noSpace];
  }

  if (KNOWN_LANGUAGE_LABELS.has(raw)) {
    return raw;
  }

  return raw;
}

function normalizeLanguageSlug(value) {
  const label = normalizeLanguageLabel(value);
  const lower = String(value || label).trim().toLowerCase();

  if (lower === 'c++') {
    return 'cpp';
  }

  if (lower === 'c#') {
    return 'csharp';
  }

  if (lower === 'ms sql server') {
    return 'mssql';
  }

  return lower.replace(/[^a-z0-9]+/g, '');
}

function directText(element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join('')
    .trim();
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function extractLanguageFromDom() {
  const candidates = Array.from(
    document.querySelectorAll('button, [role="button"], [role="combobox"], span, div'),
  );

  for (const element of candidates) {
    if (!isVisible(element)) {
      continue;
    }

    const text = directText(element) || element.textContent.trim();

    if (text.length > 24) {
      continue;
    }

    const label = normalizeLanguageLabel(text);

    if (KNOWN_LANGUAGE_LABELS.has(label)) {
      return label;
    }
  }

  return '';
}

function extractCodeFromDom() {
  const codeMirror = document.querySelector('.CodeMirror-code');

  if (codeMirror && codeMirror.innerText.trim()) {
    return codeMirror.innerText
      .split('\n')
      .filter((line, index) => index % 2 === 1 || !/^\d+$/.test(line.trim()))
      .join('\n')
      .trim();
  }

  const monacoLines = Array.from(document.querySelectorAll('.view-lines .view-line'));
  if (monacoLines.length > 0) {
    const code = monacoLines.map((line) => line.textContent).join('\n').trim();

    if (code) {
      return code;
    }
  }

  const textarea = Array.from(document.querySelectorAll('textarea'))
    .map((element) => element.value || '')
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];

  return textarea || '';
}

function parseTitleAndNumber(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^([A-Za-z]*\s*\d+[A-Za-z-]*)\.\s+(.+)$/);

  if (match) {
    return {
      number: match[1].trim(),
      title: match[2].trim(),
    };
  }

  return {
    number: '',
    title: text,
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function extractProblemFromDom(problemSlug) {
  const titleElement = document.querySelector(
    '[data-cy="question-title"], [data-e2e-locator="question-title"], h1',
  );
  const documentTitle = document.title.replace(/\s+-\s+LeetCode\s*$/i, '');
  const parsedTitle = parseTitleAndNumber(
    firstNonEmpty(titleElement && titleElement.textContent, documentTitle),
  );
  const descriptionElement = document.querySelector(
    '[data-track-load="description_content"], [data-cy="question-content"], .question-content, .question-description',
  );
  const metaDescription = document.querySelector('meta[name="description"]');
  const difficulty = findDifficultyText();

  return {
    content: descriptionElement
      ? descriptionElement.innerHTML
      : metaDescription
        ? metaDescription.content
        : '',
    difficulty,
    questionFrontendId: parsedTitle.number,
    title: parsedTitle.title || problemSlug.replace(/-/g, ' '),
    titleSlug: problemSlug,
    topicTags: [],
  };
}

function findDifficultyText() {
  const elements = Array.from(document.querySelectorAll('span, div, button'));

  for (const element of elements) {
    if (!isVisible(element)) {
      continue;
    }

    const text = directText(element) || element.textContent.trim();

    if (text === 'Easy' || text === 'Medium' || text === 'Hard') {
      return text;
    }
  }

  return '';
}

function htmlToMarkdown(html) {
  const raw = String(html || '').trim();

  if (!raw) {
    return '';
  }

  if (!raw.includes('<')) {
    return raw;
  }

  const doc = new DOMParser().parseFromString(`<main>${raw}</main>`, 'text/html');
  const root = doc.querySelector('main');
  const markdown = childrenToMarkdown(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown;
}

function childrenToMarkdown(element) {
  return Array.from(element.childNodes).map(nodeToMarkdown).join('');
}

function inlineChildrenToMarkdown(element) {
  return Array.from(element.childNodes)
    .map(nodeToMarkdown)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function nodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.replace(/\s+/g, ' ');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'pre') {
    return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
  }

  if (tag === 'code') {
    return `\`${node.textContent.replace(/`/g, '\\`')}\``;
  }

  if (tag === 'strong' || tag === 'b') {
    return `**${inlineChildrenToMarkdown(node)}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${inlineChildrenToMarkdown(node)}*`;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `${'#'.repeat(level)} ${inlineChildrenToMarkdown(node)}\n\n`;
  }

  if (tag === 'p' || tag === 'section' || tag === 'article') {
    return `${inlineChildrenToMarkdown(node)}\n\n`;
  }

  if (tag === 'ul' || tag === 'ol') {
    return listToMarkdown(node, tag === 'ol');
  }

  if (tag === 'table') {
    return tableToMarkdown(node);
  }

  if (tag === 'sup') {
    return `^${inlineChildrenToMarkdown(node)}`;
  }

  if (tag === 'sub') {
    return `_${inlineChildrenToMarkdown(node)}`;
  }

  return childrenToMarkdown(node);
}

function listToMarkdown(list, ordered) {
  const items = Array.from(list.children).filter(
    (child) => child.tagName && child.tagName.toLowerCase() === 'li',
  );

  return `${items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}.` : '-';
      return `${prefix} ${inlineChildrenToMarkdown(item).replace(/\n/g, '\n  ')}`;
    })
    .join('\n')}\n\n`;
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) =>
      inlineChildrenToMarkdown(cell).replace(/\|/g, '\\|'),
    ),
  );

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => {
    const clone = row.slice();
    while (clone.length < columnCount) {
      clone.push('');
    }
    return clone;
  });
  const header = normalized[0];
  const separator = header.map(() => '---');
  const bodyRows = normalized.slice(1);

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row.join(' | ')} |`),
    '',
    '',
  ].join('\n');
}

function normalizeQuestion(question, fallbackSlug) {
  const fallback = extractProblemFromDom(fallbackSlug);
  const data = question || fallback;

  return {
    descriptionMarkdown: htmlToMarkdown(data.content || fallback.content),
    difficulty: data.difficulty || fallback.difficulty,
    problemNumber: data.questionFrontendId || fallback.questionFrontendId,
    problemSlug: data.titleSlug || fallback.titleSlug || fallbackSlug,
    problemTitle: data.title || fallback.title,
    problemUrl: `https://leetcode.com/problems/${data.titleSlug || fallbackSlug}/`,
    tags: Array.isArray(data.topicTags)
      ? data.topicTags.map((tag) => tag.name).filter(Boolean)
      : [],
  };
}

async function extractSubmission(acceptedDetail = {}, options = {}) {
  const problemSlug = getProblemSlug();
  const allowEditorFallback = options.allowEditorFallback !== false;

  if (!problemSlug) {
    throw new Error('Open a LeetCode problem page before syncing.');
  }

  const [question, editorSnapshot, submissionDetails] = await Promise.all([
    fetchQuestionData(problemSlug).catch(() => null),
    allowEditorFallback
      ? requestEditorSnapshot()
      : Promise.resolve({ code: '', language: '' }),
    acceptedDetail.submissionDetails
      ? Promise.resolve(acceptedDetail.submissionDetails)
      : fetchSubmissionDetails(acceptedDetail.submissionId).catch(() => null),
  ]);
  const normalizedQuestion = normalizeQuestion(
    submissionDetails && submissionDetails.question
      ? submissionDetails.question
      : question,
    problemSlug,
  );
  const code = firstNonEmpty(
    acceptedDetail.code,
    submissionDetails && submissionDetails.code,
    allowEditorFallback && editorSnapshot.code,
    allowEditorFallback && extractCodeFromDom(),
  );
  const language = normalizeLanguageLabel(
    firstNonEmpty(
      acceptedDetail.langSlug,
      acceptedDetail.lang,
      submissionDetails && submissionDetails.lang,
      allowEditorFallback && editorSnapshot.language,
      allowEditorFallback && extractLanguageFromDom(),
    ),
  );
  const langSlug = normalizeLanguageSlug(
    firstNonEmpty(
      acceptedDetail.langSlug,
      acceptedDetail.lang,
      submissionDetails && submissionDetails.lang,
      allowEditorFallback && editorSnapshot.language,
      language,
    ),
  );

  return {
    ...normalizedQuestion,
    code,
    language,
    langSlug,
    memory: firstNonEmpty(
      acceptedDetail.memory,
      submissionDetails && (submissionDetails.memoryDisplay || submissionDetails.memory),
    ),
    runtime: firstNonEmpty(
      acceptedDetail.runtime,
      submissionDetails && (submissionDetails.runtimeDisplay || submissionDetails.runtime),
    ),
  };
}

function hashText(text) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }

  return String(hash);
}

function submissionFingerprint(submission) {
  return [
    submission.problemSlug,
    submission.langSlug,
    hashText(submission.code || ''),
  ].join(':');
}

function showPageStatus(message, tone = 'pending') {
  let element = document.getElementById(PAGE_STATUS_ID);

  if (!element) {
    element = document.createElement('div');
    element.id = PAGE_STATUS_ID;
    element.style.position = 'fixed';
    element.style.right = '16px';
    element.style.bottom = '16px';
    element.style.zIndex = '2147483647';
    element.style.maxWidth = '340px';
    element.style.borderRadius = '8px';
    element.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.22)';
    element.style.font = '13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    element.style.padding = '10px 12px';
    document.documentElement.appendChild(element);
  }

  const colors = {
    error: ['#fff1f0', '#b42318', '#fda29b'],
    ok: ['#ecfdf3', '#067647', '#75e0a7'],
    pending: ['#fff7ed', '#9a3412', '#fdba74'],
  };
  const [background, color, border] = colors[tone] || colors.pending;

  element.textContent = message;
  element.style.background = background;
  element.style.border = `1px solid ${border}`;
  element.style.color = color;

  if (tone === 'ok') {
    window.clearTimeout(element.__leetsyncDismissTimer);
    element.__leetsyncDismissTimer = window.setTimeout(() => {
      element.remove();
    }, 8000);
  }
}

function emitManualSyncProgress(requestId, message) {
  if (!requestId) {
    return;
  }

  const progressMessage = extensionApi.runtime.sendMessage({
    message,
    requestId,
    type: 'LEETSYNC_MANUAL_SYNC_PROGRESS',
  });

  if (progressMessage && typeof progressMessage.catch === 'function') {
    progressMessage.catch(() => {});
  }
}

async function uploadPreparedSubmission(submission) {
  const response = await extensionApi.runtime.sendMessage({
    type: 'LEETSYNC_UPLOAD_SUBMISSION',
    submission,
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || 'GitHub upload failed.');
  }

  return response;
}

function formatManualSuccessMessage(submission) {
  const problemNumber = String(submission.problemNumber || '').trim();

  if (/^\d+$/.test(problemNumber)) {
    return `Successfully synced ${problemNumber.padStart(4, '0')} - ${submission.problemTitle}`;
  }

  if (problemNumber) {
    return `Successfully synced ${problemNumber} - ${submission.problemTitle}`;
  }

  return `Successfully synced ${submission.problemTitle}`;
}

async function syncAcceptedSolution(source, acceptedDetail = {}) {
  if (syncInFlight) {
    return {
      ok: false,
      error: 'A LeetSync upload is already running.',
    };
  }

  syncInFlight = true;
  showPageStatus('LeetSync is syncing the accepted solution...', 'pending');

  try {
    const submission = await extractSubmission(acceptedDetail);
    const fingerprint = submissionFingerprint(submission);

    if (source !== 'manual' && fingerprint === lastSyncedFingerprint) {
      return {
        ok: true,
        message: 'This accepted solution was already synced.',
      };
    }

    const response = await uploadPreparedSubmission(submission);

    lastSyncedFingerprint = fingerprint;
    showPageStatus(response.message || 'LeetSync upload complete.', 'ok');

    return {
      ok: true,
      message: response.message || 'Accepted solution synced.',
    };
  } catch (error) {
    showPageStatus(error.message || 'LeetSync upload failed.', 'error');

    return {
      ok: false,
      error: error.message || 'LeetSync upload failed.',
    };
  } finally {
    syncInFlight = false;
  }
}

async function syncCurrentAcceptedSolution(requestId) {
  if (syncInFlight) {
    return {
      ok: false,
      error: 'A LeetSync upload is already running.',
    };
  }

  syncInFlight = true;

  try {
    const problemSlug = getProblemSlug();

    if (!problemSlug) {
      throw new Error('Open a LeetCode problem page, then try manual sync again.');
    }

    emitManualSyncProgress(requestId, 'Finding latest Accepted submission...');
    showPageStatus('Finding latest Accepted submission...', 'pending');
    const acceptedDetail = await getLatestAcceptedSubmissionDetail(problemSlug);

    emitManualSyncProgress(requestId, 'Preparing solution...');
    showPageStatus('Preparing accepted solution...', 'pending');
    const submission = await extractSubmission(acceptedDetail, {
      allowEditorFallback: false,
    });

    emitManualSyncProgress(requestId, 'Uploading to GitHub...');
    showPageStatus('Uploading accepted solution to GitHub...', 'pending');
    const response = await uploadPreparedSubmission(submission);
    const message = formatManualSuccessMessage(submission);

    lastSyncedFingerprint = submissionFingerprint(submission);
    showPageStatus(response.message || message, 'ok');

    return {
      ok: true,
      message,
    };
  } catch (error) {
    const message = error.message || 'Manual sync failed.';

    showPageStatus(message, 'error');

    return {
      ok: false,
      error: message,
    };
  } finally {
    syncInFlight = false;
  }
}

function queueAutoSync(acceptedDetail = {}) {
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    syncAcceptedSolution('auto', acceptedDetail);
  }, 700);
}

function recordSubmitIntent(event) {
  const target = event.target;
  const control =
    target && target.closest
      ? target.closest('button, [role="button"], [data-e2e-locator]')
      : null;
  const text = control ? control.textContent.replace(/\s+/g, ' ').trim() : '';

  if (/^submit$/i.test(text)) {
    lastSubmitAt = Date.now();
  }
}

function recordKeyboardSubmit(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    lastSubmitAt = Date.now();
  }
}

function hasAcceptedTextInDom() {
  const nodes = Array.from(
    document.querySelectorAll('span, div, p, button, [role="status"], [data-e2e-locator]'),
  );

  return nodes.some((node) => {
    if (!isVisible(node)) {
      return false;
    }

    const text = directText(node) || node.textContent.trim();
    return text === 'Accepted';
  });
}

function scheduleDomAcceptedCheck() {
  if (!isProblemPage() || Date.now() - lastSubmitAt > RECENT_SUBMIT_WINDOW_MS) {
    return;
  }

  window.clearTimeout(scheduleDomAcceptedCheck.timer);
  scheduleDomAcceptedCheck.timer = window.setTimeout(() => {
    if (hasAcceptedTextInDom()) {
      queueAutoSync({});
    }
  }, 250);
}

function startDomAcceptedObserver() {
  const observer = new MutationObserver(scheduleDomAcceptedCheck);
  observer.observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
}

window.addEventListener(ACCEPTED_EVENT, (event) => {
  lastSubmitAt = Date.now();
  queueAutoSync(event.detail || {});
});

document.addEventListener('click', recordSubmitIntent, true);
document.addEventListener('keydown', recordKeyboardSubmit, true);

extensionApi.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'LEETSYNC_SYNC_CURRENT_ACCEPTED') {
    return false;
  }

  return syncCurrentAcceptedSolution(message.requestId);
});

installPageBridge();
startDomAcceptedObserver();
