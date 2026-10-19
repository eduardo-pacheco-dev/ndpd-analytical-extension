// Content script bridge: receives popup requests and returns the analysis.
// "NDPD_ANALYZE_ALL" walks the navigator twice: outer (sections/steps/tabs) and,
// when the active content holds its own stepper/tabs, the inner steps as well.
(function () {
  "use strict";

  const VERSION = 6;
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

  function planOf(root) {
    return window.NdPdAnalyzer.planNavigator(root);
  }

  function activeIndex(root, kind) {
    const analyzer = window.NdPdAnalyzer;
    return analyzer.navNodes(root, kind).findIndex((node) => analyzer.nodeActive(kind, node));
  }

  function contentSignature(root) {
    const analyzer = window.NdPdAnalyzer;
    const scope = analyzer.activeContentScope(root);
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
      if (role === "tablist" || role === "presentation") {
        targets.push(node.parentElement);
        if (role === "presentation" && node.parentElement.parentElement) {
          targets.push(node.parentElement.parentElement);
        }
      }
    }
    return targets;
  }

  async function settleContent(root, before) {
    if (contentSignature(root) === before) {
      await waitFor(() => contentSignature(root) !== before, 2500, 100);
    }
    let previous = null;
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const signature = contentSignature(root);
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

  async function activate(root, kind, index) {
    const analyzer = window.NdPdAnalyzer;
    const node = analyzer.navNodes(root, kind)[index];
    if (!node) return { ok: false, reason: "node-not-found" };
    if (activeIndex(root, kind) === index) return { ok: true, reason: "already-active" };

    const before = contentSignature(root);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const target of clickTargets(node)) {
        fireClick(target);

        if (await waitFor(() => activeIndex(root, kind) === index, 1400, 80)) {
          await settleContent(root, before);
          return { ok: true, reason: "active" };
        }

        if (contentSignature(root) !== before) {
          await settleContent(root, before);
          return { ok: true, reason: "content-changed" };
        }
      }

      try {
        if (typeof node.focus === "function") node.focus();
        for (const type of ["keydown", "keypress", "keyup"]) {
          node.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
        }
        if (await waitFor(() => activeIndex(root, kind) === index, 1200, 80)) {
          await settleContent(root, before);
          return { ok: true, reason: "keyboard" };
        }
      } catch (error) {
        /* KeyboardEvent may be unavailable */
      }

      await sleep(220);
    }

    return { ok: false, reason: "could-not-activate" };
  }

  function emptyCapture() {
    return { items: [], fields: [], attachments: [] };
  }

  // Collects one navigator level; returns the entries (and how many were rendered).
  async function collectLevel(root, kind, labelPrefix, onProgress, progressBase) {
    const analyzer = window.NdPdAnalyzer;
    const items = planOf(root).items;
    const initialActive = activeIndex(root, kind);
    const assumedActive = initialActive >= 0 ? initialActive : 0;
    const entries = [];

    for (let index = 0; index < items.length; index += 1) {
      const current = planOf(root).items[index] || items[index];
      if (onProgress && progressBase) {
        onProgress({
          current: progressBase.current + index,
          total: progressBase.total,
          label: (labelPrefix ? labelPrefix + " › " : "") + current.label,
        });
      }

      const activation =
        index === assumedActive && initialActive < 0
          ? { ok: true, reason: "assumed-active" }
          : await activate(root, kind, index);

      const fresh = planOf(root).items[index] || current;
      const captured = activation.ok ? analyzer.captureCurrent(root, kind, fresh) : emptyCapture();

      log(
        `nível "${labelPrefix || kind}" item ${index + 1}/${items.length} "${current.label}" ok=${activation.ok} (${activation.reason}) ` +
          `itens=${captured.items.length} campos=${captured.fields.length} anexos=${captured.attachments.length}`
      );

      entries.push({
        index,
        ref: {
          ...fresh,
          label: (labelPrefix ? labelPrefix + " › " : "") + (fresh.label || fresh.name),
          code: labelPrefix ? labelPrefix + "." + (fresh.code || index + 1) : fresh.code,
        },
        rendered: activation.ok,
        ...captured,
      });
    }

    if (initialActive >= 0 && activeIndex(root, kind) !== initialActive) {
      await activate(root, kind, initialActive);
      log(`nível "${labelPrefix || kind}" restaurado no item ${initialActive}.`);
    }

    return entries;
  }

  async function collectAll(onProgress) {
    const analyzer = window.NdPdAnalyzer;
    const outer = planOf(document);
    const collected = [];

    log(
      "iniciando coleta:",
      outer.kind,
      "| navegadores externos =",
      outer.items.length,
      "| ativo =",
      activeIndex(document, outer.kind)
    );

    if (outer.items.length === 0) {
      const captured = analyzer.captureCurrent(document, outer.kind, null);
      collected.push({ index: 0, ref: null, rendered: true, ...captured });
    } else {
      const outerActive = activeIndex(document, outer.kind);
      const assumed = outerActive >= 0 ? outerActive : 0;

      for (let index = 0; index < outer.items.length; index += 1) {
        const current = planOf(document).items[index] || outer.items[index];
        if (onProgress) onProgress({ current: index + 1, total: outer.items.length, label: current.label });

        const activation =
          index === assumed && outerActive < 0
            ? { ok: true, reason: "assumed-active" }
            : await activate(document, outer.kind, index);

        if (!activation.ok) {
          log(`externo ${index + 1} "${current.label}" não ativou (${activation.reason}).`);
          collected.push({
            index: collected.length,
            ref: current,
            rendered: false,
            ...emptyCapture(),
          });
          continue;
        }

        // Is there a nested navigator (stepper/tabs) inside the active content?
        const outerNodes = analyzer.navNodes(document, outer.kind);
        const scope = analyzer.activeContentScope(document, outerNodes);
        const inner = planOf(scope);

        if (inner.items.length > 1 && inner.kind !== "checklist") {
          log(
            `seção "${current.label}" tem navegador interno (${inner.kind}, ${inner.items.length} itens).`
          );
          const innerEntries = await collectLevel(
            scope,
            inner.kind,
            current.label,
            onProgress,
            { current: index + 1, total: outer.items.length }
          );
          for (const entry of innerEntries) {
            collected.push({ ...entry, index: collected.length });
          }
        } else {
          const captured = analyzer.captureCurrent(document, outer.kind, current, outerNodes);
          log(
            `externo ${index + 1} "${current.label}" ok=true (${activation.reason}) itens=${captured.items.length} campos=${captured.fields.length}`
          );
          collected.push({ index: collected.length, ref: current, rendered: true, ...captured });
        }
      }

      if (outerActive >= 0 && activeIndex(document, outer.kind) !== outerActive) {
        await activate(document, outer.kind, outerActive);
        log("posição externa original restaurada:", outerActive);
      }
    }

    if (onProgress) onProgress({ current: outer.items.length, total: outer.items.length, done: true });

    const report = analyzer.buildReport(document, location, collected, "all", outer.kind);
    window.__ndpdLastReport = report;
    log("coleta concluída:", JSON.stringify(report.summary));
    return report;
  }

  function analyzeActive() {
    return window.NdPdAnalyzer.analyzeDocument(document, window.location);
  }

  window.NdPdScraper = { collectAll, activate, activeIndex, contentSignature, collectLevel };

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
    const outer = analyzer ? analyzer.planNavigator(document) : { kind: "unknown", items: [] };
    const scope = analyzer ? analyzer.activeContentScope(document) : null;
    const inner = analyzer && scope ? analyzer.planNavigator(scope) : { kind: "none", items: [] };
    const sample = Array.from(document.querySelectorAll("[class*='step'], [class*='wizard'], [role='tab']"))
      .filter((node) => node.closest && !node.closest(".cdk-overlay-pane, [role='menu']"))
      .slice(0, 12)
      .map((node) => node.tagName.toLowerCase() + "." + String(node.className || "").split(" ").slice(0, 2).join("."));

    const info = {
      version: VERSION,
      url: location.href,
      outer: {
        kind: outer.kind,
        items: outer.items.map((item) => ({ label: item.label, active: item.active })),
        activeIndex: activeIndex(document, outer.kind),
      },
      inner: {
        kind: inner.kind,
        items: inner.items.map((item) => ({ label: item.label, active: item.active })),
        activeIndex: inner.items.length ? activeIndex(scope, inner.kind) : -1,
      },
      fieldsInView: analyzer ? analyzer.readFields(analyzer.activeContentScope(document)).length : 0,
      checklistItems: document.querySelectorAll(".content-item").length,
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
