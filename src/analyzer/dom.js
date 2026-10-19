// Small DOM helpers that do not belong to a specific page shape.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.dom = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function headerElement(node) {
    for (const child of node.children) {
      if (child.tagName === "DIV") return child;
    }
    return node.firstElementChild || null;
  }

  function isHidden(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
      const style = node.getAttribute && node.getAttribute("style");
      if (style && /display:\s*none|visibility:\s*hidden/i.test(style)) return true;
      node = node.parentElement;
    }
    return false;
  }

  return { headerElement, isHidden };
});
