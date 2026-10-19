// Status resolution for checklist items and attachments.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("../shared/constants.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.status = factory(ndpd.shared.text, ndpd.shared.constants);
})(typeof globalThis === "object" ? globalThis : this, function (text, constants) {
  "use strict";

  const { clean } = text;
  const { STATUS_MAP, AWAITING_RE } = constants;

  function readStatus(el) {
    if (!el || !el.classList) return "unknown";
    for (const key of Object.keys(STATUS_MAP)) {
      if (el.classList.contains(key)) return STATUS_MAP[key];
    }
    return "unknown";
  }

  function resolveStatus(statusEl, headerText) {
    if (statusEl) {
      const byClass = readStatus(statusEl);
      if (byClass !== "unknown") return byClass;
      if (AWAITING_RE.test(clean(statusEl.textContent))) return "awaiting";
    }
    const haystack = clean((statusEl ? statusEl.textContent : "") + " " + (headerText || ""));
    if (AWAITING_RE.test(haystack)) return "awaiting";
    // Items without any recognizable status are treated as pending.
    return "pending";
  }

  function firstStatusIn(root) {
    if (!root) return null;
    return root.querySelector(constants.STATUS_SELECTOR);
  }

  return { readStatus, resolveStatus, firstStatusIn };
});
