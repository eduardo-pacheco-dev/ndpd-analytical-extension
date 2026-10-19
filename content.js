// Content script entry point: wires the analyzer + collector into a messaging bridge.
(function () {
  "use strict";

  const VERSION = 8;
  const MAX_DEPTH = 4;
  const PREFIX = "[NDPd Analytical]";

  function log(...args) {
    console.info(PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(PREFIX, ...args);
  }

  const registered = window.__ndpdAnalytical;
  if (registered && registered.version === VERSION && registered.listener) {
    log("content script v" + VERSION + " já registrado; ignorando duplicata.");
    return;
  }
  if (registered && registered.listener) {
    try {
      chrome.runtime.onMessage.removeListener(registered.listener);
      log("listener anterior removido (v" + registered.version + ").");
    } catch (error) {
      warn("não foi possível remover listener anterior:", error && error.message);
    }
  }

  // Ticker used for smooth progress; guarded because some test sandboxes lack setInterval.
  // Wrapped in arrow functions so the native timer keeps its required `this` (window).
  const timers =
    typeof setInterval === "function" && typeof clearInterval === "function"
      ? { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id) }
      : null;

  const analyzer = window.NdPdAnalyzer || null;
  const collector = analyzer
    ? window.NdPd.content.collector.createCollector({
        analyzer,
        window,
        document,
        location,
        maxDepth: MAX_DEPTH,
        timers,
        log,
        warn,
      })
    : null;

  function collectAll(onProgress) {
    if (!collector) {
      return Promise.reject(new Error("Analisador não carregado nesta página."));
    }
    return collector.collectAll(onProgress).then((report) => {
      window.__ndpdLastReport = report;
      log("coleta concluída:", JSON.stringify(report.summary));
      return report;
    });
  }

  function analyzeActive() {
    if (!analyzer) throw new Error("Analisador não carregado nesta página.");
    return analyzer.analyzeDocument(document, window.location);
  }

  window.NdPdScraper = {
    collectAll,
    collectScope: collector && collector.collectScope,
    activate: collector && collector.activate,
    activeIndex: collector && collector.activeIndex,
    contentSignature: collector && collector.contentSignature,
  };

  const handleMessage = window.NdPd.content.bridge.createMessageHandler({
    collector: { collectAll },
    analyzeActive,
    hasAnalyzer: () => Boolean(window.NdPdAnalyzer),
    notifyProgress: (progress) => chrome.runtime.sendMessage({ type: "NDPD_PROGRESS", progress }),
    log,
    warn,
  });

  chrome.runtime.onMessage.addListener(handleMessage);
  window.__ndpdAnalytical = { version: VERSION, listener: handleMessage };

  window.__ndpdDiagnostics = function () {
    if (!analyzer) return { version: VERSION, error: "analisador não carregado" };

    const level0 = analyzer.detectNavigator(document, new Set());
    const scope0 = analyzer.activeContentScope(document, level0 ? level0.nodes : []);
    const used1 = new Set(level0 ? level0.nodes : []);
    const level1 = analyzer.detectNavigator(scope0, used1);
    const sample = Array.from(document.querySelectorAll("[class*='step'], [class*='wizard'], [role='tab']"))
      .filter((node) => node.closest && !node.closest(".cdk-overlay-pane, [role='menu']"))
      .slice(0, 15)
      .map((node) => node.tagName.toLowerCase() + "." + String(node.className || "").split(" ").slice(0, 2).join("."));

    const info = {
      version: VERSION,
      url: location.href,
      level0: {
        kind: level0 ? level0.kind : "none",
        items: level0 ? level0.items.map((item) => ({ label: item.label, active: item.active })) : [],
      },
      level1: {
        kind: level1 ? level1.kind : "none",
        items: level1 ? level1.items.map((item) => ({ label: item.label, active: item.active })) : [],
      },
      candidates: {
        matStepHeaders: document.querySelectorAll("mat-step-header, .mat-step-header").length,
        tabLabels: document.querySelectorAll(".mat-tab-label").length,
        roleTabs: document.querySelectorAll("[role='tab']").length,
        tablists: document.querySelectorAll("[role='tablist']").length,
        sidebarItems: document.querySelectorAll("app-checklist-side-sections .sidebar-item").length,
        samples: sample,
      },
    };
    console.info(PREFIX, "diagnóstico", info);
    return info;
  };

  log("content script v" + VERSION + " registrado. Use window.__ndpdDiagnostics() para inspecionar a página.");
})();
