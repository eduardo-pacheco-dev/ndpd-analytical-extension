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

  // Broader visibility check that also understands CSS-driven hiding (inactive steps/tabs
  // are often hidden with a class, not with inline styles). `checkVisibility` is used when
  // the browser provides it; otherwise the attribute/inline-style check is authoritative
  // (jsdom has no layout engine, so `offsetParent` is always null there).
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && el.hasAttribute("hidden")) return false;
    if (isHidden(el)) return false;
    if (typeof el.checkVisibility === "function") {
      try {
        return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
      } catch (error) {
        return true;
      }
    }
    return true;
  }

  return { headerElement, isHidden, isVisible };
});
