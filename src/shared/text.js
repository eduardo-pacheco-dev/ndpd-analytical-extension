// Pure text helpers shared by analyzer, popup and tests.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.shared = ndpd.shared || {};
  ndpd.shared.text = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLabel(text) {
    return clean(
      String(text == null ? "" : text)
        .replace(/\*?\s*required/gi, " ")
        .replace(/\bobrigat[óo]rio\b/gi, " ")
        .replace(/\*/g, " ")
    );
  }

  // Reads a "9/10" style badge.
  function parseBadge(text) {
    const raw = clean(text);
    const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return { accepted: null, total: null, raw };
    return { accepted: Number(match[1]), total: Number(match[2]), raw };
  }

  return { clean, cleanLabel, parseBadge };
});
