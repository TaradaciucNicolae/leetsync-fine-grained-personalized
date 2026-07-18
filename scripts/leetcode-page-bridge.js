(function () {
  const ACCEPTED_EVENT = 'LEETSYNC_FINE_GRAINED_ACCEPTED';
  const EDITOR_REQUEST_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_REQUEST';
  const EDITOR_RESPONSE_EVENT = 'LEETSYNC_FINE_GRAINED_EDITOR_RESPONSE';

  if (window.__LEETSYNC_FINE_GRAINED_BRIDGE_INSTALLED__) {
    return;
  }

  window.__LEETSYNC_FINE_GRAINED_BRIDGE_INSTALLED__ = true;

  function relevantUrl(url) {
    const value = String(url || '');
    return value.includes('/submissions/detail/') || value.includes('/graphql');
  }

  function acceptedValue(value) {
    return String(value || '').trim().toLowerCase() === 'accepted';
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

  function acceptedDetailFromObject(value) {
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

    if (!statusFields.some(acceptedValue)) {
      return null;
    }

    return {
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
      submissionId: value.submission_id || value.submissionId || value.id || '',
    };
  }

  function findAcceptedDetail(root) {
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

      const direct = acceptedDetailFromObject(current);
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

  function inspectResponse(url, text) {
    if (!relevantUrl(url) || !text) {
      return;
    }

    try {
      const parsed = JSON.parse(text);
      const acceptedDetail = findAcceptedDetail(parsed);

      if (acceptedDetail) {
        window.dispatchEvent(
          new CustomEvent(ACCEPTED_EVENT, {
            detail: acceptedDetail,
          }),
        );
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
      return originalFetch.apply(this, args).then((response) => {
        try {
          const request = args[0];
          const url =
            typeof request === 'string'
              ? request
              : request && request.url
                ? request.url
                : '';

          if (relevantUrl(url)) {
            response
              .clone()
              .text()
              .then((text) => inspectResponse(url, text))
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

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('loadend', () => {
      try {
        const responseType = this.responseType || 'text';

        if (responseType === 'text' || responseType === '') {
          inspectResponse(this.__leetsyncFineGrainedUrl, this.responseText);
        }
      } catch (error) {
        // Keep LeetCode's XHR behavior untouched if inspection fails.
      }
    });

    return originalSend.apply(this, arguments);
  };
})();
