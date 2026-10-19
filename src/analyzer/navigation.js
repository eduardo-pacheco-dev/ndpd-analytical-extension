// Navigation model: detects sections, wizard steps and tabs, and describes each entry.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../shared/text.js"));
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.navigation = factory(ndpd.shared.text);
})(typeof globalThis === "object" ? globalThis : this, function (text) {
  "use strict";

  const { clean, cleanLabel, parseBadge } = text;

  const NAV_SELECTORS = {
    checklist: ["app-checklist-side-sections .sidebar-item"],
    steps: [
      "mat-step-header",
      "[role='tablist'] [role='tab']",
      ".mat-step-header",
      ".mat-mdc-step-header",
      ".mat-tab-group .mat-tab-label",
      ".mat-mdc-tab-group .mat-mdc-tab-label",
      ".mat-stepper-horizontal .mat-step-header",
      ".mat-stepper-vertical .mat-step-header",
    ],
    tabs: [
      "[role='tablist'] [role='tab']",
      "mat-tab-group .mat-tab-label",
      ".mat-mdc-tab-group .mat-mdc-tab-label",
    ],
  };

  function navNodes(doc, kind) {
    const selectors = NAV_SELECTORS[kind] || [];
    const found = [];
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll(selector)) found.push(node);
    }

    const unique = [];
    for (const node of found) {
      if (node.closest && node.closest("[role='menu'], .mat-menu-panel, .cdk-overlay-pane, mat-menu")) continue;
      if (unique.some((kept) => kept === node || kept.contains(node))) continue;
      unique.push(node);
    }
    return unique;
  }

  function hasActiveMarker(node) {
    if (!node) return false;
    const className = String(node.className || "");
    if (/(^|[\s-])(active|selected|current)([\s-]|$)/i.test(className)) return true;
    if (node.getAttribute && node.getAttribute("aria-selected") === "true") return true;
    const current = node.getAttribute && node.getAttribute("aria-current");
    if (current === "true" || current === "step" || current === "page") return true;
    if (node.getAttribute && node.getAttribute("aria-expanded") === "true") return true;
    // NOTE: `.mat-step-label-active` is present on EVERY Material stepper label (active or
    // not), so it must never be treated as an "active" marker. Only the truly selected
    // variants are reliable.
    if (
      node.querySelector &&
      node.querySelector(
        ".mat-step-label-selected, .mat-step-header-selected, .mat-tab-label-active," +
          ".mat-mdc-tab-label-active, .mdc-tab--active, .mat-mdc-step-active"
      )
    ) {
      return true;
    }
    return false;
  }

  function nodeActive(_kind, node) {
    return hasActiveMarker(node);
  }

  function itemFromSection(node, index) {
    const labelEl = node.querySelector(".label");
    const codeEl = node.querySelector(".bold-label");
    const badgeEl = node.querySelector(".badge");
    const badge = parseBadge(badgeEl ? badgeEl.textContent : "");
    const fullLabel = clean(labelEl ? labelEl.textContent : node.textContent);
    const code = clean(codeEl ? codeEl.textContent : "");
    return {
      index,
      code,
      name: code && fullLabel.startsWith(code) ? clean(fullLabel.slice(code.length)) : fullLabel,
      label: fullLabel || "Seção " + (index + 1),
      badge: badge.raw,
      badgeAccepted: badge.accepted,
      badgeTotal: badge.total,
      active: hasActiveMarker(node),
      counts: null,
      rendered: false,
    };
  }

  function itemFromStep(node, index) {
    const labelEl = node.querySelector(
      ".mat-step-text-label, .mat-step-label, .mat-tab-label-content, .label, .bold-label"
    );
    const label = cleanLabel(labelEl ? labelEl.textContent : node.textContent);
    return {
      index,
      code: String(index + 1),
      name: label,
      label: label ? index + 1 + ". " + label : "Passo " + (index + 1),
      active: hasActiveMarker(node),
      kind: "step",
      counts: null,
      rendered: false,
    };
  }

  function itemFromTab(node, index) {
    const labelEl = node.querySelector(".mat-tab-label-content, .label");
    const label = cleanLabel(labelEl ? labelEl.textContent : node.textContent);
    return {
      index,
      code: String(index + 1),
      name: label,
      label: label || "Aba " + (index + 1),
      active: hasActiveMarker(node),
      kind: "tab",
      counts: null,
      rendered: false,
    };
  }

  function navigatorOf(root, kind, used) {
    const usedSet = used || new Set();
    const nodes = navNodes(root, kind).filter((node) => !usedSet.has(node));
    const builder =
      kind === "checklist" ? itemFromSection : kind === "steps" ? itemFromStep : itemFromTab;
    return { kind, nodes, items: nodes.map((node, index) => builder(node, index)) };
  }

  // Picks the outermost navigator available at this level (whichever appears first in the DOM).
  function detectNavigator(root, used) {
    const candidates = ["steps", "tabs", "checklist"]
      .map((kind) => navigatorOf(root, kind, used))
      .filter((nav) => nav.nodes.length > 0);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const all = Array.from(root.querySelectorAll("*"));
    const position = (node) => all.indexOf(node);
    candidates.sort(
      (a, b) => position(a.nodes[0]) - position(b.nodes[0]) || b.items.length - a.items.length
    );
    return candidates[0];
  }

  function readSections(doc) {
    return navigatorOf(doc, "checklist").items;
  }

  function readSteps(doc) {
    return navigatorOf(doc, "steps").items;
  }

  function readTabs(doc) {
    return navigatorOf(doc, "tabs").items;
  }

  function planNavigator(doc) {
    const nav = detectNavigator(doc, new Set());
    if (!nav) return { kind: "form", items: [] };
    return { kind: nav.kind, items: nav.items };
  }

  return {
    NAV_SELECTORS,
    navNodes,
    hasActiveMarker,
    nodeActive,
    itemFromSection,
    itemFromStep,
    itemFromTab,
    navigatorOf,
    detectNavigator,
    readSections,
    readSteps,
    readTabs,
    planNavigator,
  };
});
