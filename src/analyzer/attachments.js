// Attachment (evidence) reading for checklist items.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("../shared/constants.js"),
      require("./status.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.attachments = factory(
    ndpd.shared.text,
    ndpd.shared.constants,
    ndpd.analyzer.status
  );
})(typeof globalThis === "object" ? globalThis : this, function (text, constants, status) {
  "use strict";

  const { clean } = text;
  const { readStatus, firstStatusIn } = status;

  // Walks up from the image box until a scope that also owns the name/status controls.
  function attachmentScope(box, item) {
    let el = box.parentElement;
    for (let depth = 0; el && el !== item && depth < 8; depth += 1, el = el.parentElement) {
      if (el.querySelector("textarea.text-area-for-image-name") || el.querySelector(constants.STATUS_SELECTOR)) {
        return el;
      }
    }
    return box.parentElement || box;
  }

  function readAttachments(item) {
    const boxes = Array.from(item.querySelectorAll(".imgBx"));
    return boxes.map((box) => {
      const scope = attachmentScope(box, item);
      const img = box.querySelector("img");
      const nameEl = scope.querySelector("textarea.text-area-for-image-name");
      const statusEl = firstStatusIn(scope);
      const status = statusEl ? readStatus(statusEl) : "unknown";
      return {
        name: clean(nameEl ? nameEl.value : ""),
        src: img ? img.getAttribute("src") || "" : "",
        status,
        statusLabel: statusEl ? clean(statusEl.textContent) : "",
        issues: [],
      };
    });
  }

  return { attachmentScope, readAttachments };
});
