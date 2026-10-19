// NDPd analyzer — pure DOM reading, no network access.
// Supports two shapes of the execution screen:
//   - "checklist": sidebar sections + test cases (accepted/rejected/pending);
//   - "form": stepper (mat-stepper) or tabs (mat-tab-group) with form fields.
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

  const FIELD_TYPE_LABEL = {
    text: "Texto",
    textarea: "Texto longo",
    select: "Seleção",
    radio: "Escolha única",
    checkbox: "Caixa de seleção",
    toggle: "Interruptor",
    date: "Data",
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

  function firstStatusIn(root) {
    if (!root) return null;
    return root.querySelector(STATUS_SELECTOR);
  }

  function headerElement(node) {
    for (const child of node.children) {
      if (child.tagName === "DIV") return child;
    }
    return node.firstElementChild || null;
  }

  function parseBadge(text) {
    const match = clean(text).match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return { accepted: null, total: null, raw: clean(text) };
    return { accepted: Number(match[1]), total: Number(match[2]), raw: clean(text) };
  }

  // ---------------------------------------------------------------- checklist

  function itemFromSection(node, index) {
    const labelEl = node.querySelector(".label");
    const codeEl = node.querySelector(".bold-label");
    const badgeEl = node.querySelector(".badge");
    const badge = parseBadge(badgeEl ? badgeEl.textContent : "");
    const fullLabel = clean(labelEl ? labelEl.textContent : node.textContent);
    const code = clean(codeEl ? codeEl.textContent : "");
    return {
      index,
      code,
      name: code && fullLabel.startsWith(code) ? clean(fullLabel.slice(code.length)) : fullLabel,
      label: fullLabel || "Seção " + (index + 1),
      badge: badge.raw,
      badgeAccepted: badge.accepted,
      badgeTotal: badge.total,
      active: hasActiveMarker(node),
      counts: null,
      rendered: false,
    };
  }

  function readSections(doc) {
    return navigatorOf(doc, "checklist").items;
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

  function attachmentScope(box, item) {
    let el = box.parentElement;
    for (let depth = 0; el && el !== item && depth < 8; depth += 1, el = el.parentElement) {
      if (el.querySelector("textarea.text-area-for-image-name") || el.querySelector(STATUS_SELECTOR)) {
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

  function parseItem(node, index, section) {
    const header = headerElement(node);
    const nameEl = node.querySelector("h4.testcase-name-overflow") || node.querySelector("h4");
    const name = clean(nameEl ? nameEl.textContent : `Item ${index}`);
    const headerText = clean(header ? header.textContent : "");
    const requirement = /\*Required/i.test(headerText)
      ? "required"
      : /\bOptional\b/i.test(headerText)
        ? "optional"
        : "unknown";
    const statusEl = firstStatusIn(header);
    const status = statusEl ? readStatus(statusEl) : "unknown";

    const item = {
      index,
      name,
      requirement,
      requirementLabel: REQUIREMENT_LABEL[requirement],
      status,
      statusLabel: statusEl ? clean(statusEl.textContent) : STATUS_LABEL[status],
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

  // --------------------------------------------------------------------- form

  const NAV_SELECTORS = {
    checklist: ["app-checklist-side-sections .sidebar-item"],
    steps: [
      "mat-step-header",
      "[role='tablist'] [role='tab']",
      ".mat-tab-group .mat-tab-label",
      ".mat-stepper-horizontal .mat-step-header",
      ".mat-stepper-vertical .mat-step-header",
    ],
    tabs: ["mat-tab-group .mat-tab-label", "[role='tablist'] [role='tab']"],
  };

  function navNodes(doc, kind) {
    const selectors = NAV_SELECTORS[kind] || [];
    const found = [];
    for (const selector of selectors) {
      for (const node of doc.querySelectorAll(selector)) found.push(node);
    }
    const unique = [];
    for (const node of found) {
      if (node.closest && node.closest("[role='menu'], .mat-menu-panel, .cdk-overlay-pane, mat-menu")) continue;
      if (unique.some((kept) => kept === node || kept.contains(node))) continue;
      unique.push(node);
    }
    return unique;
  }

  function hasActiveMarker(node) {
    if (!node) return false;
    const className = String(node.className || "");
    if (/(^|[\s-])(active|selected|current)([\s-]|$)/i.test(className)) return true;
    if (node.getAttribute && node.getAttribute("aria-selected") === "true") return true;
    const current = node.getAttribute && node.getAttribute("aria-current");
    if (current === "true" || current === "step" || current === "page") return true;
    if (node.getAttribute && node.getAttribute("aria-expanded") === "true") return true;
    if (
      node.querySelector &&
      node.querySelector(".mat-step-label-active, .mat-tab-label-active, .mat-step-header-selected")
    ) {
      return true;
    }
    return false;
  }

  function nodeActive(_kind, node) {
    return hasActiveMarker(node);
  }

  function itemFromStep(node, index) {
    const labelEl = node.querySelector(
      ".mat-step-text-label, .mat-step-label, .mat-tab-label-content, .label, .bold-label"
    );
    const label = cleanLabel(labelEl ? labelEl.textContent : node.textContent);
    return {
      index,
      code: String(index + 1),
      name: label,
      label: label ? index + 1 + ". " + label : "Passo " + (index + 1),
      active: hasActiveMarker(node),
      kind: "step",
      counts: null,
      rendered: false,
    };
  }

  function itemFromTab(node, index) {
    const labelEl = node.querySelector(".mat-tab-label-content, .label");
    const label = cleanLabel(labelEl ? labelEl.textContent : node.textContent);
    return {
      index,
      code: String(index + 1),
      name: label,
      label: label || "Aba " + (index + 1),
      active: hasActiveMarker(node),
      kind: "tab",
      counts: null,
      rendered: false,
    };
  }

  function navigatorOf(root, kind, used) {
    const usedSet = used || new Set();
    const nodes = navNodes(root, kind).filter((node) => !usedSet.has(node));
    const builder =
      kind === "checklist" ? itemFromSection : kind === "steps" ? itemFromStep : itemFromTab;
    return { kind, nodes, items: nodes.map((node, index) => builder(node, index)) };
  }

  // Picks the outermost navigator available at this level (whichever appears first in the DOM).
  function detectNavigator(root, used) {
    const candidates = ["steps", "tabs", "checklist"]
      .map((kind) => navigatorOf(root, kind, used))
      .filter((nav) => nav.nodes.length > 0);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const all = Array.from(root.querySelectorAll("*"));
    const position = (node) => all.indexOf(node);
    candidates.sort(
      (a, b) => position(a.nodes[0]) - position(b.nodes[0]) || b.items.length - a.items.length
    );
    return candidates[0];
  }

  function readSteps(doc) {
    return navigatorOf(doc, "steps").items;
  }

  function readTabs(doc) {
    return navigatorOf(doc, "tabs").items;
  }

  function planNavigator(doc) {
    const nav = detectNavigator(doc, new Set());
    if (!nav) return { kind: "form", items: [] };
    return { kind: nav.kind, items: nav.items };
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

  function cleanLabel(text) {
    return clean(
      String(text == null ? "" : text)
        .replace(/\*?\s*required/gi, " ")
        .replace(/\bobrigat[óo]rio\b/gi, " ")
        .replace(/\*/g, " ")
    );
  }

  function fieldScope(el) {
    return (
      el.closest(
        "mat-form-field, mat-checkbox, mat-slide-toggle, app-input-box, app-select-box, app-radio, app-check-box, app-chip, .input-field-parent, .form-field, .radio, .checkbox"
      ) ||
      el.parentElement ||
      el
    );
  }

  function nearbyHeading(el) {
    let node = fieldScope(el);
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      let sibling = node.previousElementSibling;
      for (let hop = 0; sibling && hop < 4; hop += 1, sibling = sibling.previousElementSibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) {
          const text = cleanLabel(sibling.textContent);
          if (text) return text;
        }
        if (sibling.querySelector) {
          const heading = sibling.querySelector("h1, h2, h3, h4");
          if (heading) {
            const text = cleanLabel(heading.textContent);
            if (text) return text;
          }
        }
      }
    }
    return "";
  }

  function fieldLabel(el, type) {
    const scope = fieldScope(el);
    const labelEl = scope.querySelector(
      "mat-label, .input-label, .radio-label, .checkbox__lable, label:not(.mat-radio-label):not(.mat-checkbox-layout)"
    );
    if (labelEl) {
      const text = cleanLabel(labelEl.textContent);
      if (text) return text;
    }
    const attr = clean(el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "");
    if (attr) return attr;
    const aria = clean(el.getAttribute("aria-label") || "");
    if (aria) return aria;
    const heading = nearbyHeading(el);
    if (heading) return heading;
    const valueText = type === "radio" || type === "select" ? clean(el.textContent).slice(0, 60) : "";
    return valueText ? valueText + " (sem rótulo)" : "(sem rótulo)";
  }

  function isRequired(el) {
    if (el.required || el.getAttribute("aria-required") === "true" || el.hasAttribute("required")) return true;
    const scope = fieldScope(el);
    if (!scope) return false;
    if (/\*Required/i.test(clean(scope.textContent))) return true;
    if (scope.querySelector(".required, .required-span, [required]")) return true;
    return false;
  }

  function readFields(scope) {
    if (!scope) return [];
    const fields = [];

    for (const el of scope.querySelectorAll(
      "input.mat-input-element, input[matinput], textarea.mat-input-element, textarea[matinput]"
    )) {
      if (el.type === "radio" || el.type === "checkbox" || el.type === "hidden") continue;
      if (isHidden(el)) continue;
      const value = clean(el.value);
      fields.push({
        type: el.tagName === "TEXTAREA" ? "textarea" : el.type === "date" ? "date" : "text",
        typeLabel: el.tagName === "TEXTAREA" ? FIELD_TYPE_LABEL.textarea : FIELD_TYPE_LABEL.text,
        label: fieldLabel(el, "text"),
        value,
        filled: Boolean(value),
        required: isRequired(el),
        disabled: Boolean(el.disabled),
        readonly: Boolean(el.readOnly),
      });
    }

    for (const el of scope.querySelectorAll("mat-select")) {
      if (isHidden(el)) continue;
      const valueEl = el.querySelector(".mat-select-value-text, .mat-select-min-line");
      const value = clean(valueEl ? valueEl.textContent : "");
      const placeholder = clean((el.querySelector(".mat-select-placeholder") || {}).textContent || "");
      const filled = Boolean(value) && value !== placeholder;
      fields.push({
        type: "select",
        typeLabel: FIELD_TYPE_LABEL.select,
        label: fieldLabel(el, "select"),
        value: filled ? value : "",
        filled,
        required: isRequired(el),
        disabled: el.getAttribute("aria-disabled") === "true",
        readonly: false,
      });
    }

    for (const group of scope.querySelectorAll("mat-radio-group")) {
      if (isHidden(group)) continue;
      const inputs = Array.from(group.querySelectorAll("input[type=radio]"));
      const checkedButton = group.querySelector("mat-radio-button.mat-radio-checked");
      const checkedInput = checkedButton
        ? checkedButton.querySelector("input[type=radio]")
        : group.querySelector("input[type=radio]:checked");
      fields.push({
        type: "radio",
        typeLabel: FIELD_TYPE_LABEL.radio,
        label: fieldLabel(group, "radio"),
        value: checkedInput ? checkedInput.value : "",
        filled: Boolean(checkedInput),
        options: Array.from(group.querySelectorAll("mat-radio-button")).map((b) => clean(b.textContent)),
        required: isRequired(group),
        disabled: inputs.length > 0 && inputs.every((input) => input.disabled),
        readonly: false,
      });
    }

    for (const el of scope.querySelectorAll("app-check-box, mat-checkbox")) {
      if (isHidden(el)) continue;
      const input = el.querySelector("input[type=checkbox]");
      const checked = el.classList.contains("mat-checkbox-checked") || (input && input.checked);
      fields.push({
        type: "checkbox",
        typeLabel: FIELD_TYPE_LABEL.checkbox,
        label: fieldLabel(el, "checkbox"),
        value: checked ? "Sim" : "Não",
        filled: true,
        required: isRequired(el),
        disabled: el.classList.contains("mat-checkbox-disabled") || (input && input.disabled),
        readonly: false,
      });
    }

    for (const el of scope.querySelectorAll("mat-slide-toggle")) {
      if (isHidden(el)) continue;
      const checked = el.classList.contains("mat-checked");
      fields.push({
        type: "toggle",
        typeLabel: FIELD_TYPE_LABEL.toggle,
        label: fieldLabel(el, "toggle"),
        value: checked ? "Ligado" : "Desligado",
        filled: true,
        required: isRequired(el),
        disabled: el.classList.contains("mat-disabled"),
        readonly: false,
      });
    }

    return fields;
  }

  function readAttachmentsFromScope(scope) {
    if (!scope) return [];
    return readAttachments(scope);
  }

  function contentScopes(root, avoid) {
    const selectors = [
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
    const found = [];
    for (const selector of selectors) {
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

  // Builds the checklist report from the collected entries (entry-driven, supports nesting).
  function buildChecklistReport(doc, location, collected, mode) {
    let sections = collected.map((entry, index) => {
      const ref = entry.ref || {};
      const items = entry.items || [];
      return {
        index,
        code: ref.code || "",
        name: ref.name || ref.label || "Seção " + (index + 1),
        label: ref.label || ref.name || "Seção " + (index + 1),
        badge: ref.badge || "",
        badgeAccepted: ref.badgeAccepted == null ? null : ref.badgeAccepted,
        badgeTotal: ref.badgeTotal == null ? null : ref.badgeTotal,
        active: Boolean(ref.active),
        rendered: Boolean(entry.rendered),
        counts: {
          accepted: items.filter((item) => item.status === "accepted").length,
          total: items.length,
        },
      };
    });

    // In "active section only" mode, still list every section of the sidebar.
    if (mode === "active") {
      const domSections = readSections(doc);
      const activeEntry = collected[0];
      const activeRefIndex = activeEntry && activeEntry.ref ? activeEntry.ref.index : -1;
      if (domSections.length > 0) {
        sections = domSections.map((section) => {
          const isActive = section.index === activeRefIndex;
          const items = isActive ? (activeEntry.items || []) : [];
          return {
            ...section,
            rendered: isActive,
            counts: {
              accepted: items.filter((item) => item.status === "accepted").length,
              total: items.length,
            },
          };
        });
      }
    }

    const items = [];
    for (let index = 0; index < collected.length; index += 1) {
      const section = sections[index];
      for (const item of collected[index].items || []) {
        items.push({ ...item, sectionCode: section.code, sectionLabel: section.label });
      }
    }

    const countedStatuses = ["accepted", "rejected", "pending", "performed"];
    const summary = {
      kind: "checklist",
      sections: sections.length,
      sectionsCollected: collected.filter((entry) => entry.rendered).length,
      items: items.length,
      accepted: items.filter((item) => item.status === "accepted").length,
      rejected: items.filter((item) => item.status === "rejected").length,
      pending: items.filter((item) => item.status === "pending").length,
      other: items.filter((item) => !countedStatuses.includes(item.status)).length,
      required: items.filter((item) => item.requirement === "required").length,
      optional: items.filter((item) => item.requirement === "optional").length,
      attachments: items.reduce((total, item) => total + item.attachments.length, 0),
      attachmentsRejected: items.reduce(
        (total, item) => total + item.attachments.filter((a) => a.status === "rejected").length,
        0
      ),
    };

    const issues = [];
    for (const item of items) {
      for (const issue of item.issues) {
        issues.push({ ...issue, itemIndex: item.index, itemName: item.name, section: item.sectionLabel });
      }
    }

    for (let index = 0; index < collected.length; index += 1) {
      const entry = collected[index];
      const section = sections[index];
      const label = section.label;

      if (!entry.rendered && mode !== "active") {
        issues.push({
          severity: "warning",
          code: "section-not-loaded",
          message: `Não foi possível carregar "${label}" para coleta.`,
          section: label,
        });
        continue;
      }
      if (!entry.rendered) continue;

      if (section.badgeAccepted != null) {
        if (section.badgeAccepted !== section.counts.accepted) {
          issues.push({
            severity: "warning",
            code: "badge-mismatch-accepted",
            message: `Menu lateral indica ${section.badgeAccepted} aceito(s), mas o DOM mostra ${section.counts.accepted}.`,
            section: label,
          });
        }
      }
      if (section.badgeTotal != null && section.badgeTotal !== section.counts.total) {
        issues.push({
          severity: "warning",
          code: "badge-mismatch-total",
          message: `Menu lateral indica ${section.badgeTotal} item(ns), mas o DOM mostra ${section.counts.total}.`,
          section: label,
        });
      }

      const byName = new Map();
      for (const item of entry.items || []) {
        for (const attachment of item.attachments) {
          const key = attachment.name.toLowerCase();
          if (!key) continue;
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push(item.index);
        }
      }
      for (const [name, indexes] of byName) {
        if (indexes.length < 2) continue;
        issues.push({
          severity: "warning",
          code: "attachment-duplicate",
          message: `Nome de anexo duplicado "${name}" nos itens ${indexes.map((i) => "#" + i).join(", ")}.`,
          section: label,
        });
      }
    }

    if (items.length === 0) {
      issues.push({
        severity: "warning",
        code: "no-items",
        message: "Nenhum caso de teste foi encontrado no DOM.",
      });
    }

    summary.errors = issues.filter((i) => i.severity === "error").length;
    summary.warnings = issues.filter((i) => i.severity === "warning").length;
    summary.issues = issues.length;

    const notes = [
      "Os dados são lidos diretamente da página aberta, sem acesso a servidores externos.",
      "Validações automáticas são indicativas e não substituem a conferência humana.",
    ];
    if (mode === "all") {
      notes.unshift(
        `Coleta completa: ${summary.sectionsCollected}/${summary.sections} seção(ões)/passo(s) renderizado(s) e coletado(s).`
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      mode,
      kind: "checklist",
      page: { title: clean(doc.title), url: location.href },
      workOrder: readWorkOrder(doc, location),
      sections,
      steps: [],
      items,
      fields: [],
      attachments: [],
      summary,
      issues,
      notes,
    };
  }

  // Builds the form report from the collected entries (entry-driven, supports nesting).
  function buildFormReport(doc, location, collected, mode, kind) {
    const steps = collected.map((entry, index) => {
      const ref = entry.ref || {};
      const fields = entry.fields || [];
      return {
        index,
        code: ref.code || String(index + 1),
        name: ref.name || ref.label || "Passo " + (index + 1),
        label: ref.label || ref.name || "Passo " + (index + 1),
        active: Boolean(ref.active),
        rendered: Boolean(entry.rendered),
        kind: "step",
        counts: {
          total: fields.length,
          filled: fields.filter((field) => field.filled).length,
          required: fields.filter((field) => field.required).length,
          requiredEmpty: fields.filter((field) => field.required && !field.filled).length,
        },
      };
    });

    const fields = [];
    for (let index = 0; index < collected.length; index += 1) {
      for (const field of collected[index].fields || []) {
        fields.push({ ...field, stepIndex: index + 1, stepLabel: steps[index].label });
      }
    }

    const attachments = collected.reduce(
      (all, entry) => all.concat(entry.attachments || []),
      []
    );

    const summary = {
      kind: "form",
      steps: steps.length,
      stepsCollected: collected.filter((entry) => entry.rendered).length,
      fields: fields.length,
      filled: fields.filter((field) => field.filled).length,
      empty: fields.filter((field) => !field.filled).length,
      required: fields.filter((field) => field.required).length,
      requiredEmpty: fields.filter((field) => field.required && !field.filled).length,
      attachments: attachments.length,
      attachmentsRejected: attachments.filter((a) => a.status === "rejected").length,
    };

    const issues = [];

    for (const field of fields) {
      if (field.required && !field.filled) {
        issues.push({
          severity: "error",
          code: "required-field-empty",
          message: `Campo obrigatório vazio: ${field.label}.`,
          itemIndex: field.stepIndex,
          itemName: field.stepLabel,
          section: field.stepLabel,
        });
      } else if (!field.filled && !field.disabled && !field.readonly && field.type === "select") {
        issues.push({
          severity: "warning",
          code: "select-empty",
          message: `Seleção não preenchida: ${field.label}.`,
          itemIndex: field.stepIndex,
          itemName: field.stepLabel,
          section: field.stepLabel,
        });
      }
    }

    for (let index = 0; index < collected.length; index += 1) {
      const entry = collected[index];
      const label = steps[index].label;
      if (!entry.rendered) {
        issues.push({
          severity: "warning",
          code: "step-not-loaded",
          message: `Não foi possível carregar "${label}" para coleta.`,
          section: label,
        });
      }
      for (const attachment of entry.attachments || []) {
        if (attachment.status === "rejected") {
          issues.push({
            severity: "error",
            code: "attachment-rejected",
            message: `Anexo rejeitado: ${attachment.name || "(sem nome)"}.`,
            section: label,
          });
        }
        if (!attachment.name) {
          issues.push({
            severity: "warning",
            code: "attachment-unnamed",
            message: "Anexo sem nome de arquivo.",
            section: label,
          });
        }
      }
    }

    if (fields.length === 0 && steps.length > 0) {
      issues.push({
        severity: "warning",
        code: "no-fields",
        message: "Nenhum campo de formulário foi identificado nos passos coletados.",
      });
    }

    summary.errors = issues.filter((i) => i.severity === "error").length;
    summary.warnings = issues.filter((i) => i.severity === "warning").length;
    summary.issues = issues.length;

    const notes = [
      "Formulário com passos: os campos foram lidos passo a passo e a tela voltou ao estado original.",
      "Os dados são lidos diretamente da página aberta, sem acesso a servidores externos.",
      "Validações automáticas são indicativas e não substituem a conferência humana.",
    ];
    if (mode === "all") {
      notes.unshift(
        `Coleta completa: ${summary.stepsCollected}/${summary.steps} passo(s) renderizado(s); ${summary.filled}/${summary.fields} campo(s) preenchido(s).`
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      mode,
      kind: kind === "tabs" ? "form-tabs" : "form-steps",
      page: { title: clean(doc.title), url: location.href },
      workOrder: readWorkOrder(doc, location),
      sections: [],
      steps,
      items: [],
      fields,
      attachments,
      summary,
      issues,
      notes,
    };
  }

  function buildReport(doc, location, collected, mode, kind) {
    const hasFields = collected.some((entry) => (entry.fields || []).length > 0);
    const hasItems = collected.some((entry) => (entry.items || []).length > 0);

    if (hasItems && !hasFields) {
      return buildChecklistReport(doc, location, collected, mode);
    }
    if (hasFields && !hasItems) {
      return buildFormReport(doc, location, collected, mode, kind);
    }
    if (hasFields && hasItems) {
      // Mixed content (wizard with checklist steps and plain fields): keep the form view
      // since it already groups everything by step/section.
      return buildFormReport(doc, location, collected, mode, kind);
    }

    return kind === "checklist"
      ? buildChecklistReport(doc, location, collected, mode)
      : buildFormReport(doc, location, collected, mode, kind);
  }

  // Captures a leaf (no further navigator): test cases when present, otherwise form fields.
  function captureLeaf(root, ref, avoid) {
    let nodes = Array.from(root.querySelectorAll(".checklist .content-body .content-item"));
    if (nodes.length === 0) nodes = Array.from(root.querySelectorAll(".content-item"));
    if (nodes.length > 0) {
      const items = nodes.map((node, index) => parseItem(node, index + 1, ref));
      return {
        items,
        fields: [],
        attachments: items.reduce((all, item) => all.concat(item.attachments), []),
      };
    }
    const scope = activeContentScope(root, avoid);
    return {
      items: [],
      fields: readFields(scope),
      attachments: readAttachmentsFromScope(scope),
    };
  }

  // Captures the currently rendered content (active section or current step).
  function captureCurrent(root, kind, ref, avoid) {
    if (kind === "checklist") {
      let nodes = Array.from(root.querySelectorAll(".checklist .content-body .content-item"));
      if (nodes.length === 0) nodes = Array.from(root.querySelectorAll(".content-item"));
      return {
        items: nodes.map((node, index) => parseItem(node, index + 1, ref)),
        fields: [],
        attachments: [],
      };
    }
    const scope = activeContentScope(root, avoid);
    return {
      items: [],
      fields: readFields(scope),
      attachments: readAttachmentsFromScope(scope),
    };
  }

  function analyzeDocument(doc, location) {
    const navigator = planNavigator(doc);

    if (navigator.kind === "checklist" && !doc.querySelector("app-checklist-execution-special")) {
      throw new Error(
        "Página não reconhecida como execução do NDPd. Abra a tela de execução de um checklist ou formulário."
      );
    }

    if (navigator.items.length === 0) {
      const scope = activeContentScope(doc);
      const fields = readFields(scope);
      if (fields.length === 0) {
        throw new Error(
          "Página não reconhecida como execução do NDPd. Abra a tela de execução de um checklist ou formulário."
        );
      }
      return buildFormReport(
        doc,
        location,
        [{ index: 0, ref: { index: 0, label: "Formulário", name: "Formulário" }, fields, attachments: readAttachmentsFromScope(scope), rendered: true }],
        "active",
        "form"
      );
    }

    const activeIndex = navigator.items.findIndex((item) => item.active);
    const active = activeIndex >= 0 ? navigator.items[activeIndex] : navigator.items[0];
    const captured = captureCurrent(doc, navigator.kind, active);

    return buildReport(
      doc,
      location,
      [{ index: active ? active.index : 0, ref: active, ...captured, rendered: true }],
      "active",
      navigator.kind
    );
  }

  window.NdPdAnalyzer = {
    analyzeDocument,
    buildReport,
    planNavigator,
    captureCurrent,
    captureLeaf,
    activeContentScope,
    contentScopes,
    detectNavigator,
    navigatorOf,
    navNodes,
    nodeActive,
    hasActiveMarker,
    readSections,
    readSteps,
    readTabs,
    readItems,
    readFields,
    readAttachments: readAttachmentsFromScope,
    readWorkOrder,
    clean,
    STATUS_LABEL,
    REQUIREMENT_LABEL,
    FIELD_TYPE_LABEL,
  };
})();
