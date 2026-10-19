// Messaging bridge between the popup and the page content script.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.content = ndpd.content || {};
  ndpd.content.bridge = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function errorMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  // Creates the chrome.runtime.onMessage listener. All side effects are injected.
  function createMessageHandler(deps) {
    const settings = deps || {};
    const collector = settings.collector;
    const analyzeActive = settings.analyzeActive;
    const notifyProgress = settings.notifyProgress || function () {};
    const log = settings.log || function () {};
    const warn = settings.warn || function () {};
    const hasAnalyzer = settings.hasAnalyzer || function () { return true; };

    return function handleMessage(message, _sender, sendResponse) {
      if (!message) return undefined;

      if (message.type === "NDPD_ANALYZE_ALL") {
        log("recebido NDPD_ANALYZE_ALL");
        if (!hasAnalyzer()) {
          sendResponse({ ok: false, error: "Analisador não carregado nesta página." });
          return undefined;
        }

        collector
          .collectAll((progress) => {
            try {
              notifyProgress(progress);
            } catch (error) {
              /* popup may be closed */
            }
          })
          .then((data) => sendResponse({ ok: true, data }))
          .catch((error) => {
            warn("falha na coleta:", error && error.message);
            sendResponse({ ok: false, error: errorMessage(error) });
          });
        return true;
      }

      if (message.type === "NDPD_ANALYZE") {
        log("recebido NDPD_ANALYZE");
        try {
          sendResponse({ ok: true, data: analyzeActive() });
        } catch (error) {
          sendResponse({ ok: false, error: errorMessage(error) });
        }
        return undefined;
      }

      return undefined;
    };
  }

  return { createMessageHandler, errorMessage };
});
