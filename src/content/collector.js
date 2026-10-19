// Collector: walks nested navigators (wizard > checklist > ...), rendering and scraping leaves.
// All environment access is injected so the module can be exercised without a browser.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.content = ndpd.content || {};
  ndpd.content.collector = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_MAX_DEPTH = 4;
  const CLICK_OPTIONS = { bubbles: true, cancelable: true, view: null, composed: true };

  function defaultClock() {
    return {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
  }

  function createCollector(options) {
    const opts = options || {};
    const analyzer = opts.analyzer;
    if (!analyzer) throw new Error("createCollector requer um analyzer.");

    const win = opts.window || (typeof globalThis !== "undefined" ? globalThis : undefined);
    const doc = opts.document || (win && win.document);
    const location = opts.location || (win && win.location) || { href: "" };
    const clock = opts.clock || defaultClock();
    const timers = opts.timers || null;
    const maxDepth = opts.maxDepth == null ? DEFAULT_MAX_DEPTH : opts.maxDepth;
    const log = opts.log || function () {};
    const warn = opts.warn || function () {};

    // Timing (all in ms). The NDPd/Angular screens flip `aria-selected` immediately but
    // render the step/section content asynchronously, so give the page time to load.
    const timing = {
      clickTimeout: opts.clickTimeoutMs == null ? 2500 : opts.clickTimeoutMs,
      changeTimeout: opts.changeTimeoutMs == null ? 4000 : opts.changeTimeoutMs,
      settleTimeout: opts.settleTimeoutMs == null ? 10000 : opts.settleTimeoutMs,
      settleDelay: opts.settleDelayMs == null ? 500 : opts.settleDelayMs,
      readyTimeout: opts.readyTimeoutMs == null ? 3000 : opts.readyTimeoutMs,
      pollInterval: opts.pollIntervalMs == null ? 120 : opts.pollIntervalMs,
    };

    function activeIndex(root, kind) {
      return analyzer.navNodes(root, kind).findIndex((node) => analyzer.nodeActive(kind, node));
    }

    function contentSignature(root) {
      const scope = analyzer.activeContentScope(root);
      const controlCount = scope.querySelectorAll(
        "input, textarea, mat-select, mat-radio-group, app-check-box, mat-checkbox, mat-slide-toggle, .content-item"
      ).length;
      const snippet = analyzer.clean(scope.textContent).slice(0, 120);
      return controlCount + "|" + snippet;
    }

    // "Ready" means the active scope already shows some controls/items or text. Used to
    // avoid scraping a step that is still empty while Angular renders it.
    function contentReady(root) {
      const scope = analyzer.activeContentScope(root);
      const controlCount = scope.querySelectorAll(
        "input, textarea, mat-select, mat-radio-group, app-check-box, mat-checkbox, mat-slide-toggle, .content-item"
      ).length;
      return controlCount > 0 || analyzer.clean(scope.textContent).length > 0;
    }

    async function waitFor(condition, timeout, interval) {
      const start = clock.now();
      while (clock.now() - start < timeout) {
        if (condition()) return true;
        await clock.sleep(interval);
      }
      return condition();
    }

    function fireClick(node) {
      const options = { ...CLICK_OPTIONS, view: win };
      try {
        node.dispatchEvent(new win.MouseEvent("mousedown", options));
        node.dispatchEvent(new win.MouseEvent("mouseup", options));
        node.dispatchEvent(new win.MouseEvent("click", options));
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
      // 1) Wait until the previously active content actually goes away/replaces.
      if (contentSignature(root) === before) {
        await waitFor(() => contentSignature(root) !== before, timing.changeTimeout, timing.pollInterval);
      }
      // 2) Wait until the new content exists and stops changing (Angular renders async).
      // If the scope never reports content, give up after `readyTimeout` so genuinely
      // empty steps do not block the whole collection.
      let previous = null;
      let stable = 0;
      let readyDeadline = 0;
      const start = clock.now();
      while (clock.now() - start < timing.settleTimeout) {
        const signature = contentSignature(root);
        const ready = contentReady(root);
        if (!ready && readyDeadline === 0) readyDeadline = clock.now() + timing.readyTimeout;

        if (ready && signature === previous) {
          stable += 1;
          if (stable >= 2) return;
        } else {
          stable = 0;
        }
        previous = signature;

        if (!ready && readyDeadline !== 0 && clock.now() > readyDeadline) return;
        await clock.sleep(timing.pollInterval);
      }
    }

    async function activate(root, kind, index) {
      const node = analyzer.navNodes(root, kind)[index];
      if (!node) return { ok: false, reason: "node-not-found" };
      if (activeIndex(root, kind) === index) return { ok: true, reason: "already-active" };

      const before = contentSignature(root);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        for (const target of clickTargets(node)) {
          fireClick(target);

          if (await waitFor(() => activeIndex(root, kind) === index, timing.clickTimeout, timing.pollInterval)) {
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
            node.dispatchEvent(new win.KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
          }
          if (await waitFor(() => activeIndex(root, kind) === index, timing.clickTimeout, timing.pollInterval)) {
            await settleContent(root, before);
            return { ok: true, reason: "keyboard" };
          }
        } catch (error) {
          /* KeyboardEvent may be unavailable */
        }

        await clock.sleep(timing.pollInterval);
      }

      return { ok: false, reason: "could-not-activate" };
    }

    function combineLabel(prefix, label) {
      return prefix ? prefix + " › " + label : label;
    }

    // Chooses the content region for the current navigator, preferring a wrapper that still
    // holds an inner navigator (e.g. the wizard step that contains the checklist sidebar).
    // Inactive stepper/tab panels are usually still in the DOM (hidden by CSS), so visible
    // candidates are preferred to avoid re-reading the previous step.
    function chooseScope(root, navNodes, used) {
      const all = analyzer.contentScopes(root, navNodes);
      const visible = typeof analyzer.isVisible === "function" ? all.filter((scope) => analyzer.isVisible(scope)) : all;
      const candidates = visible.length ? visible : all;
      let fallback = null;
      for (const candidate of candidates) {
        const child = analyzer.detectNavigator(candidate, used);
        if (child && child.items.length > 0) return { scope: candidate, child };
        if (!fallback) fallback = candidate;
      }
      return { scope: fallback || root.body || root, child: null };
    }

    async function collectScope(root, prefix, used, entries, onProgress, depth, trail) {
      const levels = trail || [];

      if (depth > maxDepth) {
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

      const level = { current: 1, total: nav.items.length, sub: 0 };
      levels.push(level);

      const emitProgress = (label) => {
        if (!onProgress) return;
        onProgress({
          current: level.current,
          total: level.total,
          label,
          depth,
          trail: levels.map((entry) => ({
            current: entry.current,
            total: entry.total,
            sub: entry.sub || 0,
          })),
        });
      };

      for (let index = 0; index < nav.items.length; index += 1) {
        const item = nav.items[index];
        const label = combineLabel(prefix, item.label);
        level.current = index + 1;
        level.sub = 0;
        emitProgress(label);

        // Advances the bar smoothly while the item's content is being activated/scraped.
        const ticker =
          onProgress && timers
            ? timers.set(() => {
                level.sub = Math.min(0.9, (level.sub || 0) + 0.05);
                emitProgress(label);
              }, 220)
            : null;

        try {
          const activation =
            index === assumed && initialActive < 0
              ? { ok: true, reason: "assumed-active" }
              : await activate(root, nav.kind, index);

          // Give Angular a moment to render the item content before reading it, then wait
          // for it to actually settle (this is the "delay" that fixes partial reads).
          if (activation.ok) {
            await clock.sleep(timing.settleDelay);
            await settleContent(root, null);
          }

          const chosen = activation.ok ? chooseScope(root, nodes, used) : { scope: null, child: null };
          const scope = chosen.scope;
          const child = chosen.child;

          if (activation.ok && scope && child && child.items.length > 0) {
            if (ticker) timers.clear(ticker);
            level.sub = 0;
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
        } finally {
          if (ticker) timers.clear(ticker);
          level.sub = 0;
        }
      }

      levels.pop();

      if (initialActive >= 0 && activeIndex(root, nav.kind) !== initialActive) {
        await activate(root, nav.kind, initialActive);
        log(`${"  ".repeat(depth)}nível ${depth} restaurado no item ${initialActive}.`);
      }
    }

    async function collectAll(onProgress) {
      const top = analyzer.detectNavigator(doc, new Set());
      const entries = [];

      log("iniciando coleta | navegador externo:", top ? top.kind + "/" + top.items.length : "nenhum");

      await collectScope(doc, "", new Set(), entries, onProgress, 0, []);

      if (onProgress) onProgress({ current: 1, total: 1, done: true });

      const kind = top ? top.kind : "form";
      return analyzer.buildReport(doc, location, entries, "all", kind);
    }

    return {
      collectAll,
      collectScope,
      activate,
      activeIndex,
      contentSignature,
      waitFor,
      warning: warn,
    };
  }

  return { createCollector, DEFAULT_MAX_DEPTH };
});
