// NDPd checklist analyzer — pure DOM reading, no network access.
// Loaded as a content script before content.js and also available for reuse.
(function () {
  "use strict";

  const STATUS_SELECTOR = [
    ".accepted-state",
    ".rejected-state",
    ".pending-state",
    ".performed-state",
    ".accepted-state-ground",
    ".rejected-state-ground",
    ".accepted-state-ai",
    ".rejected-state-ai",
  ].join(",");

  const STATUS_MAP = {
    "accepted-state": "accepted",
    "accepted-state-ground": "accepted",
    "accepted-state-ai": "accepted",
    "rejected-state": "rejected",
    "rejected-state-ground": "rejected",
    "rejected-state-ai": "rejected",
    "pending-state": "pending",
    "performed-state": "performed",
  };

  const STATUS_LABEL = {
    accepted: "Aceito",
    rejected: "Rejeitado",
    pending: "Pendente",
    performed: "Executado",
    unknown: "Sem status",
  };

  const REQUIREMENT_LABEL = {
    required: "Obrigatório",
    optional: "Opcional",
    unknown: "Não informado",
  };

  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readStatus(el) {
    if (!el || !el.classList) return "unknown";
    for (const key of Object.keys(STATUS_MAP)) {
      if (el.classList.contains(key)) return STATUS_MAP[key];
    }
    return "unknown";
  }

  function headerElement(node) {
    for (const child of node.children) {
      if (child.tagName === "DIV") return child;
    }
    return node.firstElementChild || null;
  }

  function firstStatusIn(root) {
    if (!root) return null;
    return root.querySelector(STATUS_SELECTOR);
  }

  function parseBadge(text) {
    const match = clean(text).match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return { accepted: null, total: null, raw: clean(text) };
    return {
      accepted: Number(match[1]),
      total: Number(match[2]),
      raw: clean(text),
    };
  }

  function readSections(doc) {
    const nodes = doc.querySelectorAll("app-checklist-side-sections .sidebar-item");
    return Array.from(nodes).map((node) => {
      const labelEl = node.querySelector(".label");
      const codeEl = node.querySelector(".bold-label");
      const badgeEl = node.querySelector(".badge");
      const badge = parseBadge(badgeEl ? badgeEl.textContent : "");
      const fullLabel = clean(labelEl ? labelEl.textContent : node.textContent);
      const code = clean(codeEl ? codeEl.textContent : "");
      return {
        code,
        name: code && fullLabel.startsWith(code) ? clean(fullLabel.slice(code.length)) : fullLabel,
        label: fullLabel,
        badge: badge.raw,
        badgeAccepted: badge.accepted,
        badgeTotal: badge.total,
        active: node.classList.contains("active"),
        counts: null,
      };
    });
  }

  function readWorkOrder(doc, location) {
    const params = new URLSearchParams(location.search);
    const headerEl =
      doc.querySelector("app-execution-view span.rex-font-header-3") ||
      doc.querySelector(".page-body-content span.rex-font-header-3") ||
      doc.querySelector(".container-header span.rex-font-header-3") ||
      doc.querySelector(".container-header h4");

    return {
      header: clean(headerEl ? headerEl.textContent : ""),
      smpId: params.get("smpId") || "",
      number: params.get("workOrderNumber") || "",
      name: params.get("name") || "",
      executeFrom: params.get("executeFrom") || "",
      isMigrated: params.get("isMigrated") || "",
    };
  }

  function attachmentScope(box, item) {
    let el = box.parentElement;
    for (let depth = 0; el && el !== item && depth < 8; depth += 1, el = el.parentElement) {
      if (
        el.querySelector("textarea.text-area-for-image-name") ||
        el.querySelector(STATUS_SELECTOR)
      ) {
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

  function readInputs(item) {
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

    if (item.attachments.length === 0 && /foto|imagem|anexo/i.test(item.name)) {
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

  function analyzeDocument(doc, location) {
    const root = doc.querySelector("app-checklist-execution-special");
    if (!root) {
      throw new Error(
        "Página não reconhecida como checklist do NDPd. Abra a tela de execução de um módulo/checklist."
      );
    }

    const sections = readSections(doc);
    const items = Array.from(doc.querySelectorAll(".checklist .content-body .content-item")).map(
      (node, index) => {
        const header = headerElement(node);
        const nameEl =
          node.querySelector("h4.testcase-name-overflow") || node.querySelector("h4");
        const name = clean(nameEl ? nameEl.textContent : `Item ${index + 1}`);
        const headerText = clean(header ? header.textContent : "");
        const requirement = /\*Required/i.test(headerText)
          ? "required"
          : /\bOptional\b/i.test(headerText)
            ? "optional"
            : "unknown";
        const statusEl = firstStatusIn(header);
        const status = statusEl ? readStatus(statusEl) : "unknown";

        const item = {
          index: index + 1,
          name,
          requirement,
          requirementLabel: REQUIREMENT_LABEL[requirement],
          status,
          statusLabel: statusEl ? clean(statusEl.textContent) : STATUS_LABEL[status],
          radio: readRadio(node),
          inputs: readInputs(node),
          attachments: readAttachments(node),
          issues: [],
        };

        item.issues = buildItemIssues(item);
        return item;
      }
    );

    const activeSectionIndex = sections.findIndex((section) => section.active);
    const activeSection = activeSectionIndex >= 0 ? sections[activeSectionIndex] : null;
    const countedStatuses = ["accepted", "rejected", "pending", "performed"];

    const summary = {
      sections: sections.length,
      items: items.length,
      accepted: items.filter((item) => item.status === "accepted").length,
      rejected: items.filter((item) => item.status === "rejected").length,
      pending: items.filter((item) => item.status === "pending").length,
      other: items.filter((item) => !countedStatuses.includes(item.status)).length,
      required: items.filter((item) => item.requirement === "required").length,
      optional: items.filter((item) => item.requirement === "optional").length,
      attachments: items.reduce((total, item) => total + item.attachments.length, 0),
      attachmentsRejected: items.reduce(
        (total, item) =>
          total + item.attachments.filter((attachment) => attachment.status === "rejected").length,
        0
      ),
      issues: items.reduce((total, item) => total + item.issues.length, 0),
      errors: 0,
      warnings: 0,
    };

    const issues = [];
    for (const item of items) {
      for (const issue of item.issues) {
        issues.push({
          ...issue,
          itemIndex: item.index,
          itemName: item.name,
          section: activeSection ? activeSection.label : "",
        });
      }
    }

    // Cross-check sidebar badge against the DOM of the active section.
    if (activeSection) {
      const computed = {
        accepted: summary.accepted,
        total: summary.items,
      };
      activeSection.counts = computed;

      if (
        activeSection.badgeAccepted != null &&
        activeSection.badgeAccepted !== computed.accepted
      ) {
        issues.push({
          severity: "warning",
          code: "badge-mismatch-accepted",
          message: `Menu lateral indica ${activeSection.badgeAccepted} aceito(s), mas o DOM mostra ${computed.accepted}.`,
          section: activeSection.label,
        });
      }
      if (activeSection.badgeTotal != null && activeSection.badgeTotal !== computed.total) {
        issues.push({
          severity: "warning",
          code: "badge-mismatch-total",
          message: `Menu lateral indica ${activeSection.badgeTotal} item(ns), mas o DOM mostra ${computed.total}.`,
          section: activeSection.label,
        });
      }
    }

    if (items.length === 0) {
      issues.push({
        severity: "warning",
        code: "no-items",
        message:
          "Nenhum caso de teste foi encontrado no DOM. A seção ativa pode não estar renderizada.",
      });
    }

    // Duplicate attachment names across the active section.
    const byName = new Map();
    for (const item of items) {
      for (const attachment of item.attachments) {
        const key = attachment.name.toLowerCase();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push({ item, attachment });
      }
    }
    for (const [name, occurrences] of byName) {
      if (occurrences.length < 2) continue;
      const where = occurrences.map((entry) => `#${entry.item.index}`).join(", ");
      issues.push({
        severity: "warning",
        code: "attachment-duplicate",
        message: `Nome de anexo duplicado "${name}" nos itens ${where}.`,
        section: activeSection ? activeSection.label : "",
      });
    }

    summary.errors = issues.filter((issue) => issue.severity === "error").length;
    summary.warnings = issues.filter((issue) => issue.severity === "warning").length;
    summary.issues = issues.length;

    return {
      generatedAt: new Date().toISOString(),
      page: {
        title: clean(doc.title),
        url: location.href,
      },
      workOrder: readWorkOrder(doc, location),
      sections,
      activeSection,
      items,
      summary,
      issues,
      notes: [
        "Somente a seção ativa é renderizada no DOM; as demais aparecem no menu lateral apenas com a contagem.",
        "Os dados são lidos diretamente da página aberta, sem acesso a servidores externos.",
        "Validações automáticas são indicativas e não substituem a conferência humana.",
      ],
    };
  }

  window.NdPdAnalyzer = {
    analyzeDocument,
    STATUS_LABEL,
    REQUIREMENT_LABEL,
  };
})();
