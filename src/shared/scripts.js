// Single source of truth for the content-script load order (used by injection + static tests).
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.shared = ndpd.shared || {};
  ndpd.shared.scripts = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // Order matters: dependencies must be loaded before their consumers.
  const CONTENT_SCRIPTS = [
    "src/shared/text.js",
    "src/shared/constants.js",
    "src/analyzer/status.js",
    "src/analyzer/dom.js",
    "src/analyzer/navigation.js",
    "src/analyzer/attachments.js",
    "src/analyzer/checklist.js",
    "src/analyzer/form.js",
    "src/analyzer/report.js",
    "src/analyzer/scopes.js",
    "src/analyzer/analyzer.js",
    "src/content/collector.js",
    "src/content/bridge.js",
    "content.js",
  ];

  const POPUP_SCRIPTS = [
    "src/shared/scripts.js",
    "src/popup/format.js",
    "src/popup/client.js",
    "src/popup/ui.js",
    "popup.js",
  ];

  return { CONTENT_SCRIPTS, POPUP_SCRIPTS };
});
