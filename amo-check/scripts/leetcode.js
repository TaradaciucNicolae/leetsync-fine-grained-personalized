const extensionApi = typeof browser !== 'undefined' ? browser : chrome;

const SUBMISSION_CREATED_EVENT = 'LEETSYNC_FINE_GRAINED_SUBMISSION_CREATED';
const SUBMISSION_RESULT_EVENT = 'LEETSYNC_FINE_GRAINED_SUBMISSION_RESULT';
const EDITOR_REQUEST_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_REQUEST';
const EDITOR_RESPONSE_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_RESPONSE';
const SUBMIT_PENDING_TIMEOUT_MS = 180000;

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

let lastSyncedFingerprint = '';
let autoSyncTimer = null;
let pendingSubmit = null;
let pendingSubmitTimer = null;
let syncInFlight = false;
const syncedAutoSubmissionIds = new Set();

function sanitizeDiagnostic(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 240);
}

function summarizeGraphQLErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return 'no GraphQL error details';
  }

  return errors
    .map((error) => sanitizeDiagnostic(error && error.message))
    .filter(Boolean)
    .slice(0, 3)
    .join('; ');
}

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
    throw new Error(`${operationName} failed with HTTP ${response.status}.`);
  }

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`${operationName} returned invalid JSON.`);
  }

  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `${operationName} GraphQL error: ${summarizeGraphQLErrors(body.errors)}.`,
    );
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

function normalizeSubmissionId(value) {
  const id = String(value || '').trim();

  return /^\d+$/.test(id) ? id : '';
}

function acceptedStatusCode(value) {
  return String(value || '').trim() === '10';
}

function statusValueIsAccepted(value) {
  return String(value || '').trim().toLowerCase() === 'accepted';
}

function knownStatusIsNotAccepted(detail) {
  if (!detail || typeof detail !== 'object') {
    return false;
  }

  const statusValues = [
    detail.status,
    detail.statusDisplay,
    detail.status_display,
    detail.statusMsg,
    detail.status_msg,
  ].filter((value) => String(value || '').trim());
  const statusCodes = [detail.statusCode, detail.status_code].filter(
    (value) => String(value || '').trim(),
  );

  if (statusValues.length > 0 && !statusValues.some(statusValueIsAccepted)) {
    return true;
  }

  return statusCodes.length > 0 && !statusCodes.some(acceptedStatusCode);
}

function languageFromSubmissionDetail(detail) {
  const lang = detail.lang;

  if (lang && typeof lang === 'object') {
    return firstNonEmpty(lang.verboseName, lang.name);
  }

  return firstNonEmpty(
    detail.langName,
    detail.lang_name,
    detail.prettyLang,
    detail.pretty_lang,
    detail.language,
    lang,
  );
}

function langSlugFromSubmissionDetail(detail) {
  const lang = detail.lang;

  if (lang && typeof lang === 'object') {
    return firstNonEmpty(detail.langSlug, detail.lang_slug, lang.name, lang.verboseName);
  }

  return firstNonEmpty(
    detail.langSlug,
    detail.lang_slug,
    detail.langName,
    detail.lang_name,
    lang,
    detail.language,
  );
}

function normalizeSubmissionDetailPayload(detail, source) {
  const question = detail.question || detail.questionData || detail.question_data || null;

  return {
    code: firstNonEmpty(
      detail.code,
      detail.submissionCode,
      detail.submission_code,
      detail.codeAnswer,
      detail.code_answer,
    ),
    lang: languageFromSubmissionDetail(detail),
    langSlug: langSlugFromSubmissionDetail(detail),
    memory: firstNonEmpty(
      detail.memoryDisplay,
      detail.memory_display,
      detail.status_memory,
      detail.memory,
    ),
    memoryPercentile: firstNonEmpty(
      detail.memoryPercentile,
      detail.memory_percentile,
      detail.memoryBeats,
      detail.memory_beats,
    ),
    question,
    runtime: firstNonEmpty(
      detail.runtimeDisplay,
      detail.runtime_display,
      detail.status_runtime,
      detail.runtime,
    ),
    runtimePercentile: firstNonEmpty(
      detail.runtimePercentile,
      detail.runtime_percentile,
      detail.runtimeBeats,
      detail.runtime_beats,
    ),
    source,
    statusCode: firstNonEmpty(detail.statusCode, detail.status_code),
    statusDisplay: firstNonEmpty(
      detail.statusDisplay,
      detail.status_display,
      detail.statusMsg,
      detail.status_msg,
      detail.status,
    ),
    submissionId: firstNonEmpty(
      detail.submissionId,
      detail.submission_id,
      detail.id,
    ),
    titleSlug: firstNonEmpty(
      detail.titleSlug,
      detail.title_slug,
      question && question.titleSlug,
      question && question.title_slug,
    ),
  };
}

async function trySubmissionDetailsGraphQL(submissionId) {
  const id = normalizeSubmissionId(submissionId);

  if (!id) {
    throw new Error('submissionDetails received an invalid submission ID.');
  }

  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        runtime
        runtimeDisplay
        runtimePercentile
        memory
        memoryDisplay
        memoryPercentile
        statusCode
        statusDisplay
        lang {
          name
          verboseName
        }
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
    submissionId: Number(id),
  });
  const detail = data.submissionDetails || null;

  if (!detail) {
    throw new Error('submissionDetails returned no submission record.');
  }

  const normalized = normalizeSubmissionDetailPayload(
    detail,
    'GraphQL submissionDetails',
  );

  if (!String(normalized.code || '').trim()) {
    throw new Error('submissionDetails returned a record but no source code.');
  }

  return normalized;
}

async function fetchSubmissionDetails(submissionId) {
  return trySubmissionDetailsGraphQL(submissionId);
}

function safeLeetCodeSubmissionUrl(rawUrl, submissionId) {
  const id = normalizeSubmissionId(submissionId);
  const fallbackPath = id ? `/submissions/detail/${id}/` : '';
  const candidate = String(rawUrl || fallbackPath).trim() || fallbackPath;
  const url = new URL(candidate, 'https://leetcode.com');

  if (url.origin !== 'https://leetcode.com') {
    throw new Error('LeetCode submission URL used an unexpected origin.');
  }

  if (!url.pathname.startsWith('/submissions/detail/')) {
    throw new Error('LeetCode submission URL used an unexpected path.');
  }

  if (id && !url.pathname.includes(`/submissions/detail/${id}`)) {
    throw new Error('LeetCode submission URL did not match the selected ID.');
  }

  return url.href;
}

async function fetchLeetCodeTextResource(url, label) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/html, text/plain, */*',
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }

  if (!text.trim()) {
    throw new Error(`${label} returned an empty response.`);
  }

  return {
    contentType: response.headers.get('content-type') || '',
    text,
  };
}

function parseJsonPayload(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned non-JSON content.`);
  }
}

function submissionPayloadMatches(detail, submissionId, problemSlug) {
  const normalized = normalizeSubmissionDetailPayload(detail, 'LeetCode fallback');

  if (!String(normalized.code || '').trim()) {
    return null;
  }

  if (knownStatusIsNotAccepted(detail)) {
    return null;
  }

  if (normalized.submissionId && normalized.submissionId !== submissionId) {
    return null;
  }

  if (normalized.titleSlug && normalized.titleSlug !== problemSlug) {
    return null;
  }

  return normalized;
}

function findSubmissionPayload(root, submissionId, problemSlug) {
  const seen = new Set();
  const stack = [root];
  let checked = 0;

  while (stack.length > 0 && checked < 5000) {
    const current = stack.pop();
    checked += 1;

    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }

    seen.add(current);

    const matched = submissionPayloadMatches(current, submissionId, problemSlug);
    if (matched) {
      return matched;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return null;
}

function parseSubmissionPayloadFromHtml(html, submissionId, problemSlug) {
  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptPattern.exec(html);

  while (match) {
    const scriptText = match[1].trim();

    if (scriptText.startsWith('{') || scriptText.startsWith('[')) {
      try {
        const parsed = JSON.parse(scriptText);
        const payload = findSubmissionPayload(parsed, submissionId, problemSlug);

        if (payload) {
          return payload;
        }
      } catch (error) {
        // Keep scanning other script blocks.
      }
    }

    match = scriptPattern.exec(html);
  }

  return null;
}

async function trySubmissionCheckFallback(acceptedRecord, problemSlug) {
  const submissionId = normalizeSubmissionId(acceptedRecord && acceptedRecord.id);
  const url = safeLeetCodeSubmissionUrl(
    `/submissions/detail/${submissionId}/check/`,
    submissionId,
  );
  const response = await fetchLeetCodeTextResource(
    url,
    'LeetCode submission check fallback',
  );
  const parsed = parseJsonPayload(
    response.text,
    'LeetCode submission check fallback',
  );
  const payload = findSubmissionPayload(parsed, submissionId, problemSlug);

  if (!payload) {
    throw new Error('LeetCode submission check fallback returned no accepted source.');
  }

  payload.source = 'LeetCode submission check fallback';
  return payload;
}

async function trySubmissionDetailPageFallback(acceptedRecord, problemSlug) {
  const submissionId = normalizeSubmissionId(acceptedRecord && acceptedRecord.id);
  const url = safeLeetCodeSubmissionUrl(acceptedRecord && acceptedRecord.url, submissionId);
  const response = await fetchLeetCodeTextResource(
    url,
    'LeetCode submission detail page fallback',
  );
  const trimmed = response.text.trim();
  let payload = null;

  if (
    response.contentType.includes('application/json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    payload = findSubmissionPayload(
      parseJsonPayload(trimmed, 'LeetCode submission detail page fallback'),
      submissionId,
      problemSlug,
    );
  } else {
    payload = parseSubmissionPayloadFromHtml(trimmed, submissionId, problemSlug);
  }

  if (!payload) {
    throw new Error('LeetCode submission detail page fallback returned no accepted source.');
  }

  payload.source = 'LeetCode submission detail page fallback';
  return payload;
}

async function trySubmissionDetailFallback(acceptedRecord, problemSlug) {
  const errors = [];
  const attempts = [
    () => trySubmissionCheckFallback(acceptedRecord, problemSlug),
    () => trySubmissionDetailPageFallback(acceptedRecord, problemSlug),
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(sanitizeDiagnostic(error.message));
    }
  }

  throw new Error(errors.join('; '));
}

function validateHistoricalSubmission(detail, acceptedRecord, problemSlug) {
  const expectedSubmissionId = normalizeSubmissionId(acceptedRecord && acceptedRecord.id);
  const actualSubmissionId = normalizeSubmissionId(detail && detail.submissionId);
  const actualTitleSlug = detail && detail.titleSlug;
  const source = detail && detail.source ? detail.source : 'Historical retrieval';

  if (!String(detail && detail.code).trim()) {
    throw new Error(`${source} returned no source code.`);
  }

  if (actualSubmissionId && actualSubmissionId !== expectedSubmissionId) {
    throw new Error('Historical retrieval returned a different submission ID.');
  }

  if (actualTitleSlug && actualTitleSlug !== problemSlug) {
    throw new Error('Historical retrieval returned a different problem.');
  }

  if (knownStatusIsNotAccepted(detail)) {
    throw new Error('Historical retrieval returned a non-Accepted submission.');
  }

  return detail;
}

async function retrieveAcceptedSubmissionSource(acceptedRecord, problemSlug) {
  const submissionId = normalizeSubmissionId(acceptedRecord && acceptedRecord.id);
  const errors = [];

  if (!submissionId) {
    throw new Error('Accepted submission history did not include a valid submission ID.');
  }

  try {
    return validateHistoricalSubmission(
      await trySubmissionDetailsGraphQL(submissionId),
      acceptedRecord,
      problemSlug,
    );
  } catch (error) {
    errors.push(`GraphQL submissionDetails failed: ${sanitizeDiagnostic(error.message)}`);
  }

  try {
    return validateHistoricalSubmission(
      await trySubmissionDetailFallback(acceptedRecord, problemSlug),
      acceptedRecord,
      problemSlug,
    );
  } catch (error) {
    errors.push(`LeetCode fallback failed: ${sanitizeDiagnostic(error.message)}`);
  }

  throw new Error(`Unable to retrieve historical source code. ${errors.join(' ')}`);
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
  const submissionDetails = await retrieveAcceptedSubmissionSource(
    acceptedRecord,
    problemSlug,
  );

  return {
    code: submissionDetails.code,
    lang: firstNonEmpty(
      submissionDetails.lang,
      acceptedRecord.langName,
      acceptedRecord.lang,
    ),
    langSlug: firstNonEmpty(
      submissionDetails.langSlug,
      acceptedRecord.lang,
      submissionDetails.lang,
    ),
    memory: firstNonEmpty(
      submissionDetails.memoryDisplay,
      submissionDetails.memory,
      acceptedRecord.memory,
    ),
    memoryPercentile: firstNonEmpty(
      submissionDetails.memoryPercentile,
      acceptedRecord.memoryPercentile,
      acceptedRecord.memory_percentile,
    ),
    runtime: firstNonEmpty(
      submissionDetails.runtimeDisplay,
      submissionDetails.runtime,
      acceptedRecord.runtime,
    ),
    runtimePercentile: firstNonEmpty(
      submissionDetails.runtimePercentile,
      acceptedRecord.runtimePercentile,
      acceptedRecord.runtime_percentile,
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
  const value = values.find(
    (candidate) =>
      candidate !== null &&
      candidate !== undefined &&
      String(candidate).trim() !== '',
  );

  return value === undefined ? '' : value;
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

function preformattedText(element) {
  return Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        return child.textContent;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      if (child.tagName.toLowerCase() === 'br') {
        return '\n';
      }

      return preformattedText(child);
    })
    .join('');
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
    return `\n\`\`\`\n${preformattedText(node).trim()}\n\`\`\`\n\n`;
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
    memoryPercentile: firstNonEmpty(
      acceptedDetail.memoryPercentile,
      acceptedDetail.memory_percentile,
      submissionDetails && submissionDetails.memoryPercentile,
      submissionDetails && submissionDetails.memory_percentile,
    ),
    runtime: firstNonEmpty(
      acceptedDetail.runtime,
      submissionDetails && (submissionDetails.runtimeDisplay || submissionDetails.runtime),
    ),
    runtimePercentile: firstNonEmpty(
      acceptedDetail.runtimePercentile,
      acceptedDetail.runtime_percentile,
      submissionDetails && submissionDetails.runtimePercentile,
      submissionDetails && submissionDetails.runtime_percentile,
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

function clearPendingSubmit() {
  window.clearTimeout(pendingSubmitTimer);
  pendingSubmitTimer = null;
  pendingSubmit = null;
}

function startPendingSubmit() {
  const problemSlug = getProblemSlug();

  if (!problemSlug) {
    return;
  }

  clearPendingSubmit();
  pendingSubmit = {
    problemSlug,
    startedAt: Date.now(),
    submissionId: '',
    syncStarted: false,
  };
  pendingSubmitTimer = window.setTimeout(
    clearPendingSubmit,
    SUBMIT_PENDING_TIMEOUT_MS,
  );
}

function detailProblemSlug(detail) {
  return String(detail.problemSlug || detail.titleSlug || detail.title_slug || '').trim();
}

function detailSubmissionId(detail) {
  return normalizeSubmissionId(
    firstNonEmpty(detail.submissionId, detail.submission_id, detail.id),
  );
}

function pendingSubmitMatches(detail = {}) {
  if (!pendingSubmit) {
    return false;
  }

  if (Date.now() - pendingSubmit.startedAt > SUBMIT_PENDING_TIMEOUT_MS) {
    clearPendingSubmit();
    return false;
  }

  const currentSlug = getProblemSlug();
  if (currentSlug && currentSlug !== pendingSubmit.problemSlug) {
    clearPendingSubmit();
    return false;
  }

  const resultSlug = detailProblemSlug(detail);
  return !resultSlug || resultSlug === pendingSubmit.problemSlug;
}

function isPendingStatusText(value) {
  const text = String(value || '').trim().toLowerCase();

  return (
    !text ||
    text === 'pending' ||
    text === 'started' ||
    text === 'judging' ||
    text === 'running' ||
    text === 'queued' ||
    text === 'compiling'
  );
}

function isAcceptedResult(detail) {
  const statusValues = [
    detail.status,
    detail.statusDisplay,
    detail.status_display,
    detail.statusMsg,
    detail.status_msg,
  ];
  const statusCodes = [detail.statusCode, detail.status_code];

  return (
    detail.accepted === true ||
    statusValues.some(statusValueIsAccepted) ||
    statusCodes.some(acceptedStatusCode)
  );
}

function isTerminalResult(detail) {
  if (isAcceptedResult(detail)) {
    return true;
  }

  const statusValues = [
    detail.status,
    detail.statusDisplay,
    detail.status_display,
    detail.statusMsg,
    detail.status_msg,
  ].filter((value) => String(value || '').trim());

  if (statusValues.some((value) => !isPendingStatusText(value))) {
    return true;
  }

  return [detail.statusCode, detail.status_code].some((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 10;
  });
}

function rememberSubmissionId(detail) {
  const submissionId = detailSubmissionId(detail);

  if (!submissionId) {
    return;
  }

  if (!pendingSubmit.submissionId) {
    pendingSubmit.submissionId = submissionId;
  }
}

function handleSubmissionCreated(event) {
  const detail = event.detail || {};

  if (!pendingSubmitMatches(detail)) {
    return;
  }

  rememberSubmissionId(detail);
}

function handleSubmissionResult(event) {
  const detail = event.detail || {};

  if (!pendingSubmitMatches(detail)) {
    return;
  }

  const submissionId = detailSubmissionId(detail);
  const isSubmitResponse = detail.sourceType === 'submit-response';

  if (
    pendingSubmit.submissionId &&
    submissionId &&
    submissionId !== pendingSubmit.submissionId
  ) {
    return;
  }

  if (pendingSubmit.submissionId && !submissionId && !isSubmitResponse) {
    return;
  }

  if (!pendingSubmit.submissionId && !isSubmitResponse) {
    return;
  }

  if (isSubmitResponse) {
    rememberSubmissionId(detail);
  }

  if (!isAcceptedResult(detail)) {
    if (isTerminalResult(detail)) {
      clearPendingSubmit();
    }

    return;
  }

  if (
    pendingSubmit.syncStarted ||
    (submissionId && syncedAutoSubmissionIds.has(submissionId))
  ) {
    return;
  }

  pendingSubmit.syncStarted = true;

  if (submissionId) {
    syncedAutoSubmissionIds.add(submissionId);
  }

  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    syncAcceptedSolution('auto', detail).finally(clearPendingSubmit);
  }, 700);
}

async function syncAcceptedSolution(source, acceptedDetail = {}) {
  if (syncInFlight) {
    return {
      ok: false,
      error: 'A LeetSync upload is already running.',
    };
  }

  syncInFlight = true;

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

    return {
      ok: true,
      message: response.message || 'Accepted solution synced.',
    };
  } catch (error) {
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
    const acceptedDetail = await getLatestAcceptedSubmissionDetail(problemSlug);

    emitManualSyncProgress(requestId, 'Preparing solution...');
    const submission = await extractSubmission(acceptedDetail, {
      allowEditorFallback: false,
    });

    emitManualSyncProgress(requestId, 'Uploading to GitHub...');
    const response = await uploadPreparedSubmission(submission);
    const message = formatManualSuccessMessage(submission);

    lastSyncedFingerprint = submissionFingerprint(submission);

    return {
      ok: true,
      message,
    };
  } catch (error) {
    const message = error.message || 'Manual sync failed.';

    return {
      ok: false,
      error: message,
    };
  } finally {
    syncInFlight = false;
  }
}

function recordSubmitIntent(event) {
  const target = event.target;
  const control =
    target && target.closest
      ? target.closest('button, [role="button"], [data-e2e-locator]')
      : null;
  const text = control ? control.textContent.replace(/\s+/g, ' ').trim() : '';

  if (/^submit$/i.test(text)) {
    startPendingSubmit();
  }
}

window.addEventListener(SUBMISSION_CREATED_EVENT, handleSubmissionCreated);
window.addEventListener(SUBMISSION_RESULT_EVENT, handleSubmissionResult);

document.addEventListener('click', recordSubmitIntent, true);

extensionApi.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'LEETSYNC_SYNC_CURRENT_ACCEPTED') {
    return false;
  }

  return syncCurrentAcceptedSolution(message.requestId);
});

installPageBridge();
