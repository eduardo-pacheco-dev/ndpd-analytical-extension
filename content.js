// Content script bridge: receives popup requests and returns the checklist analysis.
// "NDPD_ANALYZE_ALL" walks every section of the sidebar, rendering and scraping each one.
(function () {
  "use strict";

  const VERSION = 3;
  const PREFIX = "[NDPd Analytical]";

  function log(...args) {
    console.info(PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(PREFIX, ...args);
  }

  // Versioned guard: a page loaded with an older build may already have a (now stale)
  // content script attached, so we must not skip registering the current listener.
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

  function sectionNodes(doc) {
    return Array.from(doc.querySelectorAll("app-checklist-side-sections .sidebar-item"));
  }

  function activeIndex(doc) {
    return sectionNodes(doc).findIndex((node) => node.classList.contains("active"));
  }

  function contentSignature(doc) {
    const body = doc.querySelector(".checklist .content-body");
    if (!body) return "";
    const first = body.querySelector(".content-item h4");
    return [
      body.querySelectorAll(".content-item").length,
      window.NdPdAnalyzer.clean(first ? first.textContent : "").slice(0, 80),
    ].join("|");
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

  async function activateSection(doc, index) {
    const nodes = sectionNodes(doc);
    const node = nodes[index];
    if (!node) return false;
    if (activeIndex(doc) === index) return true;

    const before = contentSignature(doc);
    clickElement(node);
    let activated = await waitFor(() => activeIndex(doc) === index, 2500, 100);

    if (!activated) {
      const label = node.querySelector(".label") || node.querySelector(".bold-label");
      if (label) clickElement(label);
      activated = await waitFor(() => activeIndex(doc) === index, 2500, 100);
    }
    if (!activated) return false;

    // Wait for the new content: either it changed, or it is already stable.
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

    return activeIndex(doc) === index;
  }

  async function collectAllSections(onProgress) {
    const doc = document;
    const analyzer = window.NdPdAnalyzer;
    const originalIndex = activeIndex(doc);
    const sections = analyzer.readSections(doc);
    const collected = [];

    log("iniciando coleta:", sections.length, "seção(ões); ativa =", originalIndex);

    for (let index = 0; index < sections.length; index += 1) {
      const current = analyzer.readSections(doc)[index] || sections[index];
      if (onProgress) {
        onProgress({ current: index + 1, total: sections.length, label: current.label });
      }

      const rendered = await activateSection(doc, index);
      const fresh = analyzer.readSections(doc)[index] || current;
      const items = rendered ? analyzer.readItems(doc, fresh) : [];
      log(`seção ${index + 1}/${sections.length} "${current.label}" renderizada=${rendered} itens=${items.length}`);
      collected.push({ sectionIndex: index, section: fresh, items, rendered });
    }

    if (originalIndex >= 0 && activeIndex(doc) !== originalIndex) {
      await activateSection(doc, originalIndex);
      log("seção original restaurada:", originalIndex);
    }

    if (onProgress) onProgress({ current: sections.length, total: sections.length, done: true });

    const report = analyzer.buildReport(doc, location, collected, "all");
    log(
      "coleta concluída: itens =",
      report.summary.items,
      "| problemas =",
      report.summary.issues
    );
    return report;
  }

  function analyzeActiveSection() {
    return window.NdPdAnalyzer.analyzeDocument(document, window.location);
  }

  function handleMessage(message, _sender, sendResponse) {
    if (!message) return undefined;

    if (message.type === "NDPD_ANALYZE_ALL") {
      log("recebido NDPD_ANALYZE_ALL");
      if (!window.NdPdAnalyzer) {
        sendResponse({ ok: false, error: "Analisador não carregado nesta página." });
        return undefined;
      }

      collectAllSections((progress) => {
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
      return true; // keep the channel open for the async response
    }

    if (message.type === "NDPD_ANALYZE") {
      log("recebido NDPD_ANALYZE");
      try {
        sendResponse({ ok: true, data: analyzeActiveSection() });
      } catch (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      }
      return undefined;
    }

    return undefined;
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  window.__ndpdAnalytical = { version: VERSION, listener: handleMessage };

  // Diagnostics helper (also used by tests): window.__ndpdDiagnostics() in the page console.
  window.__ndpdDiagnostics = function () {
    const analyzer = window.NdPdAnalyzer;
    const info = {
      version: VERSION,
      url: location.href,
      recognized: Boolean(document.querySelector("app-checklist-execution-special")),
      sections: analyzer ? analyzer.readSections(document).map((s) => s.label) : [],
      activeIndex: activeIndex(document),
      renderedItems: document.querySelectorAll(".checklist .content-body .content-item").length,
    };
    console.info(PREFIX, "diagnóstico", info);
    return info;
  };

  log("content script v" + VERSION + " registrado. Use window.__ndpdDiagnostics() para inspecionar a página.");
})();
