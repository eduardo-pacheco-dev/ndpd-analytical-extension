// Content scope discovery and leaf capture (test cases or form fields).
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./dom.js"),
      require("./checklist.js"),
      require("./form.js"),
      require("./attachments.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.scopes = factory(
    ndpd.analyzer.dom,
    ndpd.analyzer.checklist,
    ndpd.analyzer.form,
    ndpd.analyzer.attachments
  );
})(typeof globalThis === "object" ? globalThis : this, function (dom, checklist, form, attachments) {
  "use strict";

  const { isVisible } = dom;
  const { parseItem } = checklist;
  const { readFieldsFromScopes, readFields } = form;
  const { readAttachmentsFromScopes } = attachments;

  // Content containers, from the most specific (active step/tab) to the broadest.
  // Both legacy Angular Material classes and MDC variants are covered.
  const CONTENT_SELECTORS = [
    ".mat-horizontal-stepper-content:not(.mat-horizontal-stepper-content-inactive)",
    ".mat-vertical-stepper-content:not(.mat-vertical-stepper-content-inactive)",
    ".mat-stepper-horizontal .mat-horizontal-stepper-content:not([aria-hidden='true'])",
    ".mat-horizontal-stepper-content[aria-expanded='true']",
    ".mat-vertical-stepper-content[aria-expanded='true']",
    ".mat-mdc-tab-body-active",
    ".mat-tab-body-active",
    "[role='tabpanel']:not([hidden])",
    ".mat-step-content",
    ".step-content",
    ".mat-mdc-tab-body-content",
    ".content-body",
    ".page-body-content",
    ".step-host",
    ".stepper-content",
    ".wizard-content",
    "app-form-view-execution",
    "form",
  ];

  const ITEM_SELECTORS = [".checklist .content-body .content-item", ".content-item"];

  function contentScopes(root, avoid) {
    const found = [];
    for (const selector of CONTENT_SELECTORS) {
      for (const node of root.querySelectorAll(selector)) {
        if (avoid && avoid.length && avoid.some((nav) => nav === node || node.contains(nav))) continue;
        if (!found.includes(node)) found.push(node);
      }
    }
    return found;
  }

  // Visible content scopes, most specific first.
  function visibleContentScopes(root, avoid) {
    return contentScopes(root, avoid).filter((scope) => isVisible(scope));
  }

  // The content scope currently rendered. Prefers a visible container, since inactive
  // steps/tabs are often still in the DOM (hidden by CSS), and picking `scopes[0]` would
  // read the wrong step.
  function activeContentScope(root, avoid) {
    const scopes = contentScopes(root, avoid);
    return scopes.find((scope) => isVisible(scope)) || scopes[0] || root.body || root;
  }

  function itemNodes(root) {
    for (const selector of ITEM_SELECTORS) {
      const nodes = Array.from(root.querySelectorAll(selector));
      if (nodes.length > 0) return nodes;
    }
    return [];
  }

  function captureItems(root, ref) {
    const nodes = itemNodes(root);
    const items = nodes.map((node, index) => parseItem(node, index + 1, ref));
    return {
      items,
      fields: [],
      attachments: items.reduce((all, item) => all.concat(item.attachments), []),
    };
  }

  // Reads every visible field/attachment for the current step. The content of a step can
  // live in several containers (nested panels, side blocks, attachments area), so all the
  // visible scopes are merged — with element-level de-duplication.
  function captureFields(root, avoid) {
    const scopes = visibleContentScopes(root, avoid);
    const targets = scopes.length ? scopes.slice() : [activeContentScope(root, avoid)];
    if (root && root.nodeType === 1 && !targets.includes(root)) targets.unshift(root);

    return {
      items: [],
      fields: readFieldsFromScopes(targets),
      attachments: readAttachmentsFromScopes(targets),
    };
  }

  // Captures a leaf (no further navigator): test cases when present, otherwise form fields.
  function captureLeaf(root, ref, avoid) {
    if (itemNodes(root).length > 0) return captureItems(root, ref);
    return captureFields(root, avoid);
  }

  // Captures the currently rendered content (active section or current step). For a
  // stepper/tab we look inside the active panel so a nested checklist is captured as
  // items instead of being silently skipped.
  function captureCurrent(root, kind, ref, avoid) {
    if (kind === "checklist") {
      const captured = captureItems(root, ref);
      return { items: captured.items, fields: [], attachments: [] };
    }
    const scope = activeContentScope(root, avoid);
    return captureLeaf(scope, ref, avoid);
  }

  return {
    contentScopes,
    visibleContentScopes,
    activeContentScope,
    captureLeaf,
    captureCurrent,
    readFields,
  };
});
