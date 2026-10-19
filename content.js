// Content script bridge: receives popup requests and returns the analysis.
// "NDPD_ANALYZE_ALL" walks every section/step/tab, renders and scrapes each one.
(function () {
  "use strict";

  const VERSION = 4;
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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function navNodes(doc, kind) {
    if (kind === "checklist") {
      return Array.from(doc.querySelectorAll("app-checklist-side-sections .sidebar-item"));
    }
    if (kind === "steps") {
      return Array.from(doc.querySelectorAll("mat-step-header, .mat-step-header"));
    }
    if (kind === "tabs") {
      return Array.from(doc.querySelectorAll("mat-tab-group .mat-tab-label"));
    }
    return [];
  }

  function nodeActive(kind, node) {
    if (!node) return false;
    if (kind === "checklist") return node.classList.contains("active");
    if (kind === "steps") {
      return (
        node.classList.contains("mat-step-header-selected") ||
        node.getAttribute("aria-selected") === "true"
      );
    }
    if (kind === "tabs") {
      return (
        node.classList.contains("mat-tab-label-active") ||
        node.getAttribute("aria-selected") === "true"
      );
    }
    return false;
  }

  function activeIndex(doc, kind) {
    return navNodes(doc, kind).findIndex((node) => nodeActive(kind, node));
  }

  function contentSignature(doc) {
    const analyzer = window.NdPdAnalyzer;
    const scope = analyzer.activeContentScope(doc);
    const controlCount = scope.querySelectorAll(
      "input, textarea, mat-select, mat-radio-group, app-check-box, mat-checkbox, .content-item"
    ).length;
    const text = analyzer.clean(scope.textContent).slice(0, 120);
    return controlCount + "|" + text;
  }

  async function waitFor(condition, timeout, interval) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (condition()) return true;
      await sleep(interval);
    }
    return condition();
  }

  function clickElement(node) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
    node.dispatchEvent(event);
  }

  async function activate(doc, kind, index) {
    const node = navNodes(doc, kind)[index];
    if (!node) return false;
    if (activeIndex(doc, kind) === index) return true;

    const before = contentSignature(doc);
    clickElement(node);
    let activated = await waitFor(() => activeIndex(doc, kind) === index, 2500, 100);

    if (!activated) {
      const label =
        node.querySelector(".mat-step-text-label, .mat-step-label, .label, .bold-label, span") || node;
      clickElement(label);
      activated = await waitFor(() => activeIndex(doc, kind) === index, 2500, 100);
    }
    if (!activated) return false;

    if (contentSignature(doc) === before) {
      await waitFor(() => contentSignature(doc) !== before, 2000, 100);
    }

    let previous = null;
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const signature = contentSignature(doc);
      if (signature && signature === previous) {
        stable += 1;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
      previous = signature;
      await sleep(120);
    }

    return activeIndex(doc, kind) === index;
  }

  async function collectAll(onProgress) {
    const analyzer = window.NdPdAnalyzer;
    const plan = analyzer.planNavigator(document);
    const originalIndex = activeIndex(document, plan.kind);
    const collected = [];

    log("iniciando coleta:", plan.kind, "| itens de navegação =", plan.items.length);

    if (plan.items.length === 0) {
      const captured = analyzer.captureCurrent(document, plan.kind, null);
      collected.push({ index: 0, ref: null, rendered: true, ...captured });
    } else {
      for (let index = 0; index < plan.items.length; index += 1) {
        const current = analyzer.planNavigator(document).items[index] || plan.items[index];
        if (onProgress) {
          onProgress({ current: index + 1, total: plan.items.length, label: current.label });
        }

        const rendered = await activate(document, plan.kind, index);
        const fresh = analyzer.planNavigator(document).items[index] || current;
        const captured = rendered
          ? analyzer.captureCurrent(document, plan.kind, fresh)
          : { items: [], fields: [], attachments: [] };
        log(
          `item ${index + 1}/${plan.items.length} "${current.label}" renderizado=${rendered} campos=${captured.fields.length} itens=${captured.items.length}`
        );
        collected.push({ index, ref: fresh, rendered, ...captured });
      }

      if (originalIndex >= 0 && activeIndex(document, plan.kind) !== originalIndex) {
        await activate(document, plan.kind, originalIndex);
        log("posição original restaurada:", originalIndex);
      }
    }

    if (onProgress) onProgress({ current: plan.items.length, total: plan.items.length, done: true });

    const report = analyzer.buildReport(document, location, collected, "all", plan.kind);
    log("coleta concluída:", JSON.stringify(report.summary));
    return report;
  }

  function analyzeActive() {
    return window.NdPdAnalyzer.analyzeDocument(document, window.location);
  }

  window.NdPdScraper = { collectAll, activate, activeIndex, contentSignature, navNodes };

  function handleMessage(message, _sender, sendResponse) {
    if (!message) return undefined;

    if (message.type === "NDPD_ANALYZE_ALL") {
      log("recebido NDPD_ANALYZE_ALL");
      if (!window.NdPdAnalyzer) {
        sendResponse({ ok: false, error: "Analisador não carregado nesta página." });
        return undefined;
      }

      collectAll((progress) => {
        try {
          chrome.runtime.sendMessage({ type: "NDPD_PROGRESS", progress });
        } catch (error) {
          /* popup may be closed */
        }
      })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => {
          warn("falha na coleta:", error && error.message);
          sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
        });
      return true;
    }

    if (message.type === "NDPD_ANALYZE") {
      log("recebido NDPD_ANALYZE");
      try {
        sendResponse({ ok: true, data: analyzeActive() });
      } catch (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      }
      return undefined;
    }

    return undefined;
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  window.__ndpdAnalytical = { version: VERSION, listener: handleMessage };

  window.__ndpdDiagnostics = function () {
    const analyzer = window.NdPdAnalyzer;
    const plan = analyzer ? analyzer.planNavigator(document) : { kind: "unknown", items: [] };
    const info = {
      version: VERSION,
      url: location.href,
      kind: plan.kind,
      navigatorItems: plan.items.map((item) => item.label),
      fields: analyzer ? analyzer.readFields(analyzer.activeContentScope(document)).length : 0,
      checklistItems: document.querySelectorAll(".checklist .content-body .content-item").length,
    };
    console.info(PREFIX, "diagnóstico", info);
    return info;
  };

  log("content script v" + VERSION + " registrado. Use window.__ndpdDiagnostics() para inspecionar a página.");
})();
