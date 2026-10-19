// Content scope discovery and leaf capture (test cases or form fields).
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./checklist.js"),
      require("./form.js"),
      require("./attachments.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.scopes = factory(
    ndpd.analyzer.checklist,
    ndpd.analyzer.form,
    ndpd.analyzer.attachments
  );
})(typeof globalThis === "object" ? globalThis : this, function (checklist, form, attachments) {
  "use strict";

  const { parseItem } = checklist;
  const { readFields } = form;
  const { readAttachments } = attachments;

  const CONTENT_SELECTORS = [
    ".mat-stepper-horizontal .mat-horizontal-stepper-content:not([aria-hidden='true'])",
    ".mat-horizontal-stepper-content[aria-expanded='true']",
    ".mat-vertical-stepper-content[aria-expanded='true']",
    ".mat-tab-body-active",
    ".mat-step-content",
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

  function activeContentScope(root, avoid) {
    const scopes = contentScopes(root, avoid);
    return scopes[0] || root.body || root;
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

  function captureFields(root, avoid) {
    const scope = activeContentScope(root, avoid);
    return {
      items: [],
      fields: readFields(scope),
      attachments: readAttachments(scope),
    };
  }

  // Captures a leaf (no further navigator): test cases when present, otherwise form fields.
  function captureLeaf(root, ref, avoid) {
    if (itemNodes(root).length > 0) return captureItems(root, ref);
    return captureFields(root, avoid);
  }

  // Captures the currently rendered content (active section or current step).
  function captureCurrent(root, kind, ref, avoid) {
    if (kind === "checklist") {
      const captured = captureItems(root, ref);
      return { items: captured.items, fields: [], attachments: [] };
    }
    return captureFields(root, avoid);
  }

  return { contentScopes, activeContentScope, captureLeaf, captureCurrent };
});
