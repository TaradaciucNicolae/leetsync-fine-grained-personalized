(function () {
  const SUBMISSION_CREATED_EVENT = 'LEETSYNC_FINE_GRAINED_SUBMISSION_CREATED';
  const SUBMISSION_RESULT_EVENT = 'LEETSYNC_FINE_GRAINED_SUBMISSION_RESULT';
  const EDITOR_REQUEST_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_REQUEST';
  const EDITOR_RESPONSE_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_RESPONSE';

  if (window.__LEETSYNC_FINE_GRAINED_BRIDGE_INSTALLED__) {
    return;
  }

  window.__LEETSYNC_FINE_GRAINED_BRIDGE_INSTALLED__ = true;

  function submissionIdFromUrl(url) {
    const match = String(url || '').match(/\/submissions\/detail\/(\d+)/);

    return match ? match[1] : '';
  }

  function submitProblemSlugFromUrl(url) {
    const match = String(url || '').match(/\/problems\/([^/]+)\/submit\/?/);

    return match ? match[1] : '';
  }

  function parseRequestBody(body) {
    if (!body) {
      return {};
    }

    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (error) {
        return {};
      }
    }

    if (body instanceof URLSearchParams) {
      try {
        return JSON.parse(body.toString());
      } catch (error) {
        return {};
      }
    }

    return {};
  }

  function requestInfoFromBody(body) {
    const parsed = parseRequestBody(body);

    return {
      operationName: parsed.operationName || '',
      variables: parsed.variables || {},
    };
  }

  function relevantResponse(url, requestInfo) {
    const value = String(url || '');

    if (value.includes('/problems/') && value.includes('/submit')) {
      return true;
    }

    if (value.includes('/submissions/detail/')) {
      return true;
    }

    return (
      value.includes('/graphql') &&
      requestInfo &&
      requestInfo.operationName === 'submissionDetails'
    );
  }

  function acceptedValue(value) {
    return String(value || '').trim().toLowerCase() === 'accepted';
  }

  function acceptedStatusCode(value) {
    return String(value || '').trim() === '10';
  }

  function pendingValue(value) {
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

  function terminalStatus(value) {
    return String(value || '').trim() && !pendingValue(value);
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

  function submissionCreatedFromObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const submissionId = firstNonEmpty(
      value.submission_id,
      value.submissionId,
      value.submissionID,
    );

    if (!submissionId) {
      return null;
    }

    return {
      problemSlug: fallback.problemSlug || value.titleSlug || value.title_slug || '',
      sourceType: 'submit-response',
      submissionId,
    };
  }

  function submissionResultFromObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const statusFields = [
      value.status_msg,
      value.statusMsg,
      value.statusDisplay,
      value.status_display,
      value.status,
    ];
    const statusCodes = [value.status_code, value.statusCode];
    const accepted =
      statusFields.some(acceptedValue) || statusCodes.some(acceptedStatusCode);
    const terminal =
      accepted ||
      statusFields.some(terminalStatus) ||
      statusCodes.some((statusCode) => Number(statusCode) >= 10);

    if (!terminal) {
      return null;
    }

    return {
      accepted,
      code: value.code || value.submissionCode || value.submission_code || value.code_answer || '',
      lang: value.lang || value.pretty_lang || value.prettyLang || value.language || '',
      langSlug: value.langSlug || value.lang_slug || '',
      memory: value.status_memory || value.memory || value.memoryDisplay || '',
      memoryPercentile: firstNonEmpty(
        value.memoryPercentile,
        value.memory_percentile,
        value.memoryBeats,
        value.memory_beats,
      ),
      runtime: value.status_runtime || value.runtime || value.runtimeDisplay || '',
      runtimePercentile: firstNonEmpty(
        value.runtimePercentile,
        value.runtime_percentile,
        value.runtimeBeats,
        value.runtime_beats,
      ),
      problemSlug: firstNonEmpty(
        fallback.problemSlug,
        value.titleSlug,
        value.title_slug,
        value.question && value.question.titleSlug,
      ),
      sourceType: fallback.sourceType || '',
      status: firstNonEmpty(...statusFields),
      statusCode: firstNonEmpty(...statusCodes),
      submissionId: firstNonEmpty(
        fallback.submissionId,
        value.submission_id,
        value.submissionId,
        value.id,
      ),
    };
  }

  function findDetail(root, getDetail) {
    const seen = new Set();
    const stack = [root];
    let checked = 0;

    while (stack.length > 0 && checked < 1000) {
      const current = stack.pop();
      checked += 1;

      if (!current || typeof current !== 'object' || seen.has(current)) {
        continue;
      }

      seen.add(current);

      const direct = getDetail(current);
      if (direct) {
        return direct;
      }

      for (const value of Object.values(current)) {
        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }

    return null;
  }

  function dispatchEvent(name, detail) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail,
      }),
    );
  }

  function inspectResponse(url, text, requestInfo = {}) {
    if (!relevantResponse(url, requestInfo) || !text) {
      return;
    }

    try {
      const parsed = JSON.parse(text);
      const problemSlug = submitProblemSlugFromUrl(url);
      const urlSubmissionId = submissionIdFromUrl(url);
      const graphQLSubmissionId =
        requestInfo.variables && requestInfo.variables.submissionId
          ? String(requestInfo.variables.submissionId)
          : '';

      if (problemSlug) {
        const createdDetail = findDetail(parsed, (value) =>
          submissionCreatedFromObject(value, { problemSlug }),
        );

        if (createdDetail) {
          dispatchEvent(SUBMISSION_CREATED_EVENT, createdDetail);
        }

        const resultDetail = findDetail(parsed, (value) =>
          submissionResultFromObject(value, {
            problemSlug,
            sourceType: 'submit-response',
            submissionId: createdDetail && createdDetail.submissionId,
          }),
        );

        if (resultDetail) {
          dispatchEvent(SUBMISSION_RESULT_EVENT, resultDetail);
        }

        return;
      }

      if (urlSubmissionId) {
        const resultDetail = findDetail(parsed, (value) =>
          submissionResultFromObject(value, {
            sourceType: 'submission-detail',
            submissionId: urlSubmissionId,
          }),
        );

        if (resultDetail) {
          dispatchEvent(SUBMISSION_RESULT_EVENT, resultDetail);
        }

        return;
      }

      if (requestInfo.operationName === 'submissionDetails') {
        const resultDetail = findDetail(parsed, (value) =>
          submissionResultFromObject(value, {
            sourceType: 'submission-details-graphql',
            submissionId: graphQLSubmissionId,
          }),
        );

        if (resultDetail) {
          dispatchEvent(SUBMISSION_RESULT_EVENT, resultDetail);
        }
      }
    } catch (error) {
      // LeetCode sometimes returns HTML for submission detail pages. The
      // content script has independent DOM/manual fallbacks for those cases.
    }
  }

  function readMonacoEditor() {
    if (!window.monaco || !window.monaco.editor || !window.monaco.editor.getModels) {
      return null;
    }

    const models = window.monaco.editor
      .getModels()
      .filter((model) => model && typeof model.getValue === 'function')
      .sort((a, b) => b.getValue().length - a.getValue().length);
    const model = models[0];

    if (!model) {
      return null;
    }

    return {
      code: model.getValue(),
      language:
        typeof model.getLanguageId === 'function' ? model.getLanguageId() : '',
    };
  }

  function readAceEditor() {
    if (!window.ace || typeof window.ace.edit !== 'function') {
      return null;
    }

    const editorElement = document.getElementById('ace-editor');
    if (!editorElement) {
      return null;
    }

    const editor = window.ace.edit(editorElement);
    if (!editor || !editor.session || typeof editor.session.getValue !== 'function') {
      return null;
    }

    return {
      code: editor.session.getValue(),
      language: '',
    };
  }

  function readCodeMirrorEditor() {
    const element = document.querySelector('.CodeMirror');
    if (!element || !element.CodeMirror || typeof element.CodeMirror.getValue !== 'function') {
      return null;
    }

    return {
      code: element.CodeMirror.getValue(),
      language: '',
    };
  }

  function readTextareaFallback() {
    const textareas = Array.from(document.querySelectorAll('textarea'))
      .map((element) => element.value || '')
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    if (!textareas[0]) {
      return null;
    }

    return {
      code: textareas[0],
      language: '',
    };
  }

  function readEditor() {
    return (
      readMonacoEditor() ||
      readAceEditor() ||
      readCodeMirrorEditor() ||
      readTextareaFallback() ||
      { code: '', language: '' }
    );
  }

  window.addEventListener(EDITOR_REQUEST_EVENT, (event) => {
    const detail = event.detail || {};

    window.dispatchEvent(
      new CustomEvent(EDITOR_RESPONSE_EVENT, {
        detail: {
          requestId: detail.requestId,
          ...readEditor(),
        },
      }),
    );
  });

  if (window.fetch) {
    const originalFetch = window.fetch;

    window.fetch = function (...args) {
      const request = args[0];
      const init = args[1] || {};
      const requestInfo = requestInfoFromBody(
        init.body || (request && request.body) || '',
      );
      return originalFetch.apply(this, args).then((response) => {
        try {
          const url =
            typeof request === 'string'
              ? request
              : request && request.url
                ? request.url
                : '';

          if (relevantResponse(url, requestInfo)) {
            response
              .clone()
              .text()
              .then((text) => inspectResponse(url, text, requestInfo))
              .catch(() => {});
          }
        } catch (error) {
          // Keep LeetCode's fetch behavior untouched if inspection fails.
        }

        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__leetsyncFineGrainedUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.__leetsyncFineGrainedRequestInfo = requestInfoFromBody(body);
    this.addEventListener('loadend', () => {
      try {
        const responseType = this.responseType || 'text';

        if (responseType === 'text' || responseType === '') {
          inspectResponse(
            this.__leetsyncFineGrainedUrl,
            this.responseText,
            this.__leetsyncFineGrainedRequestInfo,
          );
        }
      } catch (error) {
        // Keep LeetCode's XHR behavior untouched if inspection fails.
      }
    });

    return originalSend.apply(this, arguments);
  };
})();
