// Content script bridge: receives popup requests and returns the analysis.
// "NDPD_ANALYZE_ALL" walks every section/step/tab, renders and scrapes each one.
(function () {
  "use strict";

  const VERSION = 5;
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

  function activeIndex(doc, kind) {
    const analyzer = window.NdPdAnalyzer;
    return analyzer.navNodes(doc, kind).findIndex((node) => analyzer.nodeActive(kind, node));
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

  function fireClick(node) {
    const options = { bubbles: true, cancelable: true, view: window, composed: true };
    try {
      node.dispatchEvent(new MouseEvent("mousedown", options));
      node.dispatchEvent(new MouseEvent("mouseup", options));
      node.dispatchEvent(new MouseEvent("click", options));
    } catch (error) {
      if (typeof node.click === "function") node.click();
    }
  }

  function clickTargets(node) {
    const targets = [node];
    const inner = node.querySelector(
      "[role='tab'], button, .mat-step-text-label, .mat-step-label, .mat-tab-label-content, .label, .bold-label, span"
    );
    if (inner) targets.push(inner);
    if (node.parentElement && node.parentElement.getAttribute) {
      const role = node.parentElement.getAttribute("role");
      if (role === "tablist" || node.parentElement.className) targets.push(node.parentElement);
      const parentRole = node.parentElement.getAttribute("role");
      if (parentRole === "presentation" && node.parentElement.parentElement) {
        targets.push(node.parentElement.parentElement);
      }
    }
    return targets;
  }

  async function settleContent(doc, before) {
    if (contentSignature(doc) === before) {
      await waitFor(() => contentSignature(doc) !== before, 2500, 100);
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
  }

  async function activate(doc, kind, index) {
    const analyzer = window.NdPdAnalyzer;
    const node = analyzer.navNodes(doc, kind)[index];
    if (!node) return { ok: false, reason: "node-not-found" };
    if (activeIndex(doc, kind) === index) return { ok: true, reason: "already-active" };

    const before = contentSignature(doc);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const target of clickTargets(node)) {
        fireClick(target);

        const becameActive = await waitFor(() => activeIndex(doc, kind) === index, 1400, 80);
        if (becameActive) {
          await settleContent(doc, before);
          return { ok: true, reason: "active" };
        }

        if (contentSignature(doc) !== before) {
          await settleContent(doc, before);
          return { ok: true, reason: "content-changed" };
        }
      }

      // Keyboard fallback (some custom steppers react to Enter/Space).
      try {
        if (typeof node.focus === "function") node.focus();
        for (const type of ["keydown", "keypress", "keyup"]) {
          node.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
        }
        if (await waitFor(() => activeIndex(doc, kind) === index, 1200, 80)) {
          await settleContent(doc, before);
          return { ok: true, reason: "keyboard" };
        }
      } catch (error) {
        /* KeyboardEvent may not exist */
      }

      await sleep(220);
    }

    return { ok: false, reason: "could-not-activate" };
  }

  async function collectAll(onProgress) {
    const analyzer = window.NdPdAnalyzer;
    const plan = analyzer.planNavigator(document);
    const initialActive = activeIndex(document, plan.kind);
    // Some custom steppers don't expose an active marker; assume the first item is rendered.
    const assumedActive = initialActive >= 0 ? initialActive : 0;
    const collected = [];

    log(
      "iniciando coleta:",
      plan.kind,
      "| itens de navegação =",
      plan.items.length,
      "| ativo detectado =",
      initialActive
    );

    if (plan.items.length === 0) {
      const captured = analyzer.captureCurrent(document, plan.kind, null);
      collected.push({ index: 0, ref: null, rendered: true, ...captured });
    } else {
      for (let index = 0; index < plan.items.length; index += 1) {
        const current = analyzer.planNavigator(document).items[index] || plan.items[index];
        if (onProgress) {
          onProgress({ current: index + 1, total: plan.items.length, label: current.label });
        }

        const activation =
          index === assumedActive && initialActive < 0
            ? { ok: true, reason: "assumed-active" }
            : await activate(document, plan.kind, index);

        const fresh = analyzer.planNavigator(document).items[index] || current;
        const captured = activation.ok
          ? analyzer.captureCurrent(document, plan.kind, fresh)
          : { items: [], fields: [], attachments: [] };

        log(
          `item ${index + 1}/${plan.items.length} "${current.label}" ok=${activation.ok} (${activation.reason}) campos=${captured.fields.length} itens=${captured.items.length}`
        );
        collected.push({ index, ref: fresh, rendered: activation.ok, ...captured });
      }

      if (initialActive >= 0 && activeIndex(document, plan.kind) !== initialActive) {
        await activate(document, plan.kind, initialActive);
        log("posição original restaurada:", initialActive);
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

  window.NdPdScraper = { collectAll, activate, activeIndex, contentSignature };

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
    const sample = Array.from(document.querySelectorAll("[class*='step'], [class*='wizard'], [role='tab']"))
      .filter((node) => node.closest && !node.closest(".cdk-overlay-pane, [role='menu']"))
      .slice(0, 12)
      .map((node) => node.tagName.toLowerCase() + "." + String(node.className || "").split(" ").slice(0, 2).join("."));
    const info = {
      version: VERSION,
      url: location.href,
      kind: plan.kind,
      navigatorItems: plan.items.map((item) => ({ label: item.label, active: item.active })),
      activeIndex: activeIndex(document, plan.kind),
      fieldsInView: analyzer ? analyzer.readFields(analyzer.activeContentScope(document)).length : 0,
      checklistItems: document.querySelectorAll(".checklist .content-body .content-item").length,
      candidates: {
        matStepHeaders: document.querySelectorAll("mat-step-header, .mat-step-header").length,
        tabLabels: document.querySelectorAll(".mat-tab-label").length,
        roleTabs: document.querySelectorAll("[role='tab']").length,
        tablists: document.querySelectorAll("[role='tablist']").length,
        samples: sample,
      },
    };
    console.info(PREFIX, "diagnóstico", info);
    return info;
  };

  log("content script v" + VERSION + " registrado. Use window.__ndpdDiagnostics() para inspecionar a página.");
})();
