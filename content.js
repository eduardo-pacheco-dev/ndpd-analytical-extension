// Content script bridge: receives popup requests and returns the checklist analysis.
(function () {
  "use strict";

  if (window.__ndpdAnalyticalInjected) return;
  window.__ndpdAnalyticalInjected = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "NDPD_ANALYZE") return undefined;

    try {
      if (!window.NdPdAnalyzer) {
        throw new Error("Analisador não carregado nesta página.");
      }
      const data = window.NdPdAnalyzer.analyzeDocument(document, window.location);
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    }

    return undefined;
  });
})();
