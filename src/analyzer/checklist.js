// Checklist domain: parses a test-case item, its inputs/radio/attachments and validations.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("../shared/constants.js"),
      require("./dom.js"),
      require("./status.js"),
      require("./attachments.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.checklist = factory(
    ndpd.shared.text,
    ndpd.shared.constants,
    ndpd.analyzer.dom,
    ndpd.analyzer.status,
    ndpd.analyzer.attachments
  );
})(typeof globalThis === "object" ? globalThis : this, function (
  text,
  constants,
  dom,
  status,
  attachments
) {
  "use strict";

  const { clean } = text;
  const { STATUS_LABEL, REQUIREMENT_LABEL } = constants;
  const { headerElement } = dom;
  const { resolveStatus, firstStatusIn } = status;
  const { readAttachments } = attachments;

  const PHOTO_RE = /foto|imagem|anexo/i;

  function readItemInputs(item) {
    const nodes = item.querySelectorAll("input.mat-input-element, textarea.mat-input-element");
    return Array.from(nodes).map((el) => ({
      label: clean(
        el.getAttribute("placeholder") ||
          el.getAttribute("data-placeholder") ||
          el.getAttribute("aria-label") ||
          ""
      ),
      value: clean(el.value),
      disabled: Boolean(el.disabled),
      readonly: Boolean(el.readOnly),
    }));
  }

  function readRadio(item) {
    const group = item.querySelector("mat-radio-group");
    if (!group) return null;

    const buttons = Array.from(group.querySelectorAll("mat-radio-button"));
    const inputs = Array.from(group.querySelectorAll("input[type=radio]"));
    const checkedButton = group.querySelector("mat-radio-button.mat-radio-checked");
    const checkedInput = checkedButton
      ? checkedButton.querySelector("input[type=radio]")
      : group.querySelector("input[type=radio]:checked");

    return {
      options: buttons.map((button) => clean(button.textContent)),
      answer: checkedInput ? checkedInput.value : null,
      disabled: inputs.length > 0 && inputs.every((input) => input.disabled),
    };
  }

  function requirementOf(headerText) {
    if (/\*Required/i.test(headerText)) return "required";
    if (/\bOptional\b/i.test(headerText)) return "optional";
    return "unknown";
  }

  function buildItemIssues(item) {
    const issues = [];

    if (item.status === "rejected") {
      issues.push({ severity: "error", code: "item-rejected", message: "Item rejeitado." });
    }
    if (item.status === "pending") {
      issues.push({
        severity: item.requirement === "required" ? "error" : "warning",
        code: "item-pending",
        message: "Item ainda pendente.",
      });
    }
    if (item.status === "unknown") {
      issues.push({
        severity: "warning",
        code: "item-no-status",
        message: "Não foi possível identificar o status de aceite/rejeição.",
      });
      if (item.requirement === "required") {
        issues.push({
          severity: "error",
          code: "required-unanswered",
          message: "Item obrigatório sem aceite/rejeição.",
        });
      }
    }
    if (item.radio && !item.radio.answer) {
      issues.push({
        severity: item.requirement === "required" ? "error" : "warning",
        code: "radio-unanswered",
        message: "Pergunta sem opção selecionada.",
      });
    }

    const emptyRequiredInputs = item.inputs.filter(
      (input) => !input.disabled && !input.readonly && !input.value
    );
    if (item.requirement === "required" && emptyRequiredInputs.length > 0) {
      issues.push({
        severity: "error",
        code: "input-required-empty",
        message:
          "Campo obrigatório vazio: " +
          emptyRequiredInputs.map((input) => input.label || "sem rótulo").join(", "),
      });
    }

    if (item.attachments.length === 0 && PHOTO_RE.test(item.name)) {
      issues.push({
        severity: "warning",
        code: "attachment-missing",
        message: "Item de evidência fotográfica sem anexo.",
      });
    }

    for (const attachment of item.attachments) {
      if (attachment.status === "rejected") {
        const message = `Anexo rejeitado: ${attachment.name || "(sem nome)"}.`;
        attachment.issues.push({ severity: "error", code: "attachment-rejected", message });
        issues.push(attachment.issues[attachment.issues.length - 1]);
      }
      if (!attachment.name) {
        const message = "Anexo sem nome de arquivo.";
        attachment.issues.push({ severity: "warning", code: "attachment-unnamed", message });
        issues.push(attachment.issues[attachment.issues.length - 1]);
      }
    }

    return issues;
  }

  function parseItem(node, index, section) {
    const header = headerElement(node);
    const nameEl = node.querySelector("h4.testcase-name-overflow") || node.querySelector("h4");
    const name = clean(nameEl ? nameEl.textContent : `Item ${index}`);
    const headerText = clean(header ? header.textContent : "");
    const requirement = requirementOf(headerText);
    const statusEl = firstStatusIn(header);
    const itemStatus = resolveStatus(statusEl, headerText);

    const item = {
      index,
      name,
      requirement,
      requirementLabel: REQUIREMENT_LABEL[requirement],
      status: itemStatus,
      statusLabel:
        itemStatus === "awaiting"
          ? STATUS_LABEL.awaiting
          : statusEl
            ? clean(statusEl.textContent)
            : STATUS_LABEL[itemStatus],
      sectionCode: section ? section.code : "",
      sectionLabel: section ? section.label : "",
      radio: readRadio(node),
      inputs: readItemInputs(node),
      attachments: readAttachments(node),
      issues: [],
    };

    item.issues = buildItemIssues(item);
    return item;
  }

  function readItems(doc, section) {
    const nodes = doc.querySelectorAll(".checklist .content-body .content-item");
    return Array.from(nodes).map((node, index) => parseItem(node, index + 1, section));
  }

  function readWorkOrder(doc, location) {
    const params = new URLSearchParams(location.search);
    const headerEl =
      doc.querySelector("app-execution-view span.rex-font-header-3") ||
      doc.querySelector(".page-body-content span.rex-font-header-3") ||
      doc.querySelector(".container-header span.rex-font-header-3") ||
      doc.querySelector(".container-header h4") ||
      doc.querySelector(".dialog-header-title, h1, h2");

    return {
      header: clean(headerEl ? headerEl.textContent : ""),
      smpId: params.get("smpId") || "",
      number: params.get("workOrderNumber") || "",
      name: params.get("name") || "",
      executeFrom: params.get("executeFrom") || "",
      isMigrated: params.get("isMigrated") || "",
    };
  }

  return {
    readItemInputs,
    readRadio,
    requirementOf,
    buildItemIssues,
    parseItem,
    readItems,
    readWorkOrder,
  };
});
