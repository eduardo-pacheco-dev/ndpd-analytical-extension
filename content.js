// Content script bridge: receives popup requests and returns the analysis.
// "NDPD_ANALYZE_ALL" walks the navigators recursively (wizard > checklist sections, etc.),
// rendering and scraping every leaf it finds.
(function () {
  "use strict";

  const VERSION = 7;
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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  function combineLabel(prefix, label) {
    return prefix ? prefix + " › " + label : label;
  }

  // Chooses the content region for the current navigator, preferring a wrapper that still
  // holds an inner navigator (e.g. the wizard step that contains the checklist sidebar).
  function chooseScope(root, navNodes, used) {
    const analyzer = window.NdPdAnalyzer;
    const candidates = analyzer.contentScopes(root, navNodes);
    let fallback = null;
    for (const candidate of candidates) {
      const child = analyzer.detectNavigator(candidate, used);
      if (child && child.items.length > 0) return { scope: candidate, child };
      if (!fallback) fallback = candidate;
    }
    return { scope: fallback || root.body || root, child: null };
  }

  // Recursively walks navigators (outer wizard, inner checklist, ...) and captures leaves.
  async function collectScope(root, prefix, used, entries, onProgress, depth, trail) {
    const analyzer = window.NdPdAnalyzer;
    const levels = trail || [];

    if (depth > MAX_DEPTH) {
      const ref = { label: prefix || "Conteúdo", name: prefix || "Conteúdo", code: prefix || "" };
      entries.push({ index: entries.length, ref, rendered: true, ...analyzer.captureLeaf(root, ref) });
      return;
    }

    const nav = analyzer.detectNavigator(root, used);
    if (!nav || nav.items.length === 0) {
      const ref = { label: prefix || "Conteúdo", name: prefix || "Conteúdo", code: prefix || "" };
      entries.push({ index: entries.length, ref, rendered: true, ...analyzer.captureLeaf(root, ref) });
      return;
    }

    const nodes = nav.nodes.slice();
    for (const node of nodes) used.add(node);

    const initialActive = activeIndex(root, nav.kind);
    const assumed = initialActive >= 0 ? initialActive : 0;

    log(
      `${"  ".repeat(depth)}nível ${depth}: ${nav.kind} com ${nav.items.length} item(ns)` +
        (prefix ? ` dentro de "${prefix}"` : "")
    );

    const level = { current: 1, total: nav.items.length };
    levels.push(level);

    for (let index = 0; index < nav.items.length; index += 1) {
      const item = nav.items[index];
      const label = combineLabel(prefix, item.label);
      level.current = index + 1;
      if (onProgress) {
        onProgress({
          current: index + 1,
          total: nav.items.length,
          label,
          depth,
          trail: levels.map((entry) => ({ current: entry.current, total: entry.total })),
        });
      }

      const activation =
        index === assumed && initialActive < 0
          ? { ok: true, reason: "assumed-active" }
          : await activate(root, nav.kind, index);

      const chosen = activation.ok ? chooseScope(root, nodes, used) : { scope: null, child: null };
      const scope = chosen.scope;
      const child = chosen.child;

      if (activation.ok && scope && child && child.items.length > 0) {
        await collectScope(scope, label, used, entries, onProgress, depth + 1, levels);
        continue;
      }

      const ref = {
        ...item,
        label,
        name: item.name,
        code: prefix ? prefix + "." + (item.code || index + 1) : item.code,
      };

      const captured = activation.ok
        ? analyzer.captureLeaf(scope || root, ref, nodes)
        : { items: [], fields: [], attachments: [] };

      log(
        `${"  ".repeat(depth)}item ${index + 1}/${nav.items.length} "${label}" ok=${activation.ok} (${activation.reason}) ` +
          `itens=${captured.items.length} campos=${captured.fields.length} anexos=${captured.attachments.length}`
      );

      entries.push({ index: entries.length, ref, rendered: activation.ok, ...captured });
    }

    levels.pop();

    if (initialActive >= 0 && activeIndex(root, nav.kind) !== initialActive) {
      await activate(root, nav.kind, initialActive);
      log(`${"  ".repeat(depth)}nível ${depth} restaurado no item ${initialActive}.`);
    }
  }

  async function collectAll(onProgress) {
    const analyzer = window.NdPdAnalyzer;
    const top = analyzer.detectNavigator(document, new Set());
    const entries = [];

    log(
      "iniciando coleta | navegador externo:",
      top ? top.kind + "/" + top.items.length : "nenhum"
    );

    await collectScope(document, "", new Set(), entries, onProgress, 0, []);

    if (onProgress) onProgress({ current: 1, total: 1, done: true });

    const report = analyzer.buildReport(document, location, entries, "all", top ? top.kind : "form");
    window.__ndpdLastReport = report;
    log("coleta concluída:", JSON.stringify(report.summary));
    return report;
  }

  function analyzeActive() {
    return window.NdPdAnalyzer.analyzeDocument(document, window.location);
  }

  window.NdPdScraper = { collectAll, collectScope, activate, activeIndex, contentSignature };

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
