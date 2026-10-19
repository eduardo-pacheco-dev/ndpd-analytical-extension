// Report builders: turn collected entries into the final JSON report.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("./navigation.js"),
      require("./checklist.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.report = factory(ndpd.shared.text, ndpd.analyzer.navigation, ndpd.analyzer.checklist);
})(typeof globalThis === "object" ? globalThis : this, function (text, navigation, checklist) {
  "use strict";

  const { clean } = text;
  const { readSections } = navigation;
  const { readWorkOrder } = checklist;

  const CHECKLIST_STATUSES = ["accepted", "rejected", "pending", "performed", "awaiting"];

  function count(items, predicate) {
    return items.filter(predicate).length;
  }

  function finalizeSummary(summary, issues) {
    summary.errors = count(issues, (issue) => issue.severity === "error");
    summary.warnings = count(issues, (issue) => issue.severity === "warning");
    summary.issues = issues.length;
    return summary;
  }

  function createdAt(now) {
    return (typeof now === "function" ? now() : new Date()).toISOString();
  }

  // -------------------------------------------------------------- checklist report

  function sectionFromEntry(entry, index) {
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
        accepted: count(items, (item) => item.status === "accepted"),
        total: items.length,
      },
    };
  }

  function activeModeSections(doc, collected) {
    const domSections = readSections(doc);
    if (domSections.length === 0) return null;

    const activeEntry = collected[0];
    const activeRefIndex = activeEntry && activeEntry.ref ? activeEntry.ref.index : -1;
    return domSections.map((section) => {
      const isActive = section.index === activeRefIndex;
      const items = isActive ? (activeEntry.items || []) : [];
      return {
        ...section,
        rendered: isActive,
        counts: {
          accepted: count(items, (item) => item.status === "accepted"),
          total: items.length,
        },
      };
    });
  }

  function flattenItems(collected, sections) {
    const items = [];
    for (let index = 0; index < collected.length; index += 1) {
      const section = sections[index];
      for (const item of collected[index].items || []) {
        items.push({ ...item, sectionCode: section.code, sectionLabel: section.label });
      }
    }
    return items;
  }

  function checklistSummary(sections, collected, items) {
    return {
      kind: "checklist",
      sections: sections.length,
      sectionsCollected: count(collected, (entry) => entry.rendered),
      items: items.length,
      accepted: count(items, (item) => item.status === "accepted"),
      rejected: count(items, (item) => item.status === "rejected"),
      pending: count(items, (item) => item.status === "pending"),
      awaiting: count(items, (item) => item.status === "awaiting"),
      other: count(items, (item) => !CHECKLIST_STATUSES.includes(item.status)),
      required: count(items, (item) => item.requirement === "required"),
      optional: count(items, (item) => item.requirement === "optional"),
      attachments: items.reduce((total, item) => total + item.attachments.length, 0),
      attachmentsRejected: items.reduce(
        (total, item) => total + count(item.attachments, (a) => a.status === "rejected"),
        0
      ),
    };
  }

  function itemIssues(items) {
    const issues = [];
    for (const item of items) {
      for (const issue of item.issues) {
        issues.push({ ...issue, itemIndex: item.index, itemName: item.name, section: item.sectionLabel });
      }
    }
    return issues;
  }

  function sectionIssues(collected, sections, mode) {
    const issues = [];
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

      if (section.badgeAccepted != null && section.badgeAccepted !== section.counts.accepted) {
        issues.push({
          severity: "warning",
          code: "badge-mismatch-accepted",
          message: `Menu lateral indica ${section.badgeAccepted} aceito(s), mas o DOM mostra ${section.counts.accepted}.`,
          section: label,
        });
      }
      if (section.badgeTotal != null && section.badgeTotal !== section.counts.total) {
        issues.push({
          severity: "warning",
          code: "badge-mismatch-total",
          message: `Menu lateral indica ${section.badgeTotal} item(ns), mas o DOM mostra ${section.counts.total}.`,
          section: label,
        });
      }

      issues.push(...duplicateAttachmentIssues(entry.items || [], label));
    }
    return issues;
  }

  function duplicateAttachmentIssues(items, label) {
    const byName = new Map();
    for (const item of items) {
      for (const attachment of item.attachments) {
        const key = attachment.name.toLowerCase();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(item.index);
      }
    }

    const issues = [];
    for (const [name, indexes] of byName) {
      if (indexes.length < 2) continue;
      issues.push({
        severity: "warning",
        code: "attachment-duplicate",
        message: `Nome de anexo duplicado "${name}" nos itens ${indexes.map((i) => "#" + i).join(", ")}.`,
        section: label,
      });
    }
    return issues;
  }

  function buildChecklistReport(doc, location, collected, mode, now) {
    let sections = collected.map(sectionFromEntry);

    // In "active section only" mode, still list every section of the sidebar.
    if (mode === "active") {
      const domSections = activeModeSections(doc, collected);
      if (domSections) sections = domSections;
    }

    const items = flattenItems(collected, sections);
    const summary = checklistSummary(sections, collected, items);
    const issues = itemIssues(items).concat(sectionIssues(collected, sections, mode));

    if (items.length === 0) {
      issues.push({
        severity: "warning",
        code: "no-items",
        message: "Nenhum caso de teste foi encontrado no DOM.",
      });
    }

    finalizeSummary(summary, issues);

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
      generatedAt: createdAt(now),
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

  // ------------------------------------------------------------------ form report

  function stepFromEntry(entry, index) {
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
        filled: count(fields, (field) => field.filled),
        required: count(fields, (field) => field.required),
        requiredEmpty: count(fields, (field) => field.required && !field.filled),
      },
    };
  }

  function flattenFields(collected, steps) {
    const fields = [];
    for (let index = 0; index < collected.length; index += 1) {
      for (const field of collected[index].fields || []) {
        fields.push({ ...field, stepIndex: index + 1, stepLabel: steps[index].label });
      }
    }
    return fields;
  }

  function gatherAttachments(collected) {
    return collected.reduce((all, entry) => all.concat(entry.attachments || []), []);
  }

  function formSummary(steps, collected, fields, attachments) {
    return {
      kind: "form",
      steps: steps.length,
      stepsCollected: count(collected, (entry) => entry.rendered),
      fields: fields.length,
      filled: count(fields, (field) => field.filled),
      empty: count(fields, (field) => !field.filled),
      required: count(fields, (field) => field.required),
      requiredEmpty: count(fields, (field) => field.required && !field.filled),
      attachments: attachments.length,
      attachmentsRejected: count(attachments, (a) => a.status === "rejected"),
    };
  }

  function fieldIssues(fields) {
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
    return issues;
  }

  function stepIssues(collected, steps) {
    const issues = [];
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
    return issues;
  }

  function buildFormReport(doc, location, collected, mode, kind, now) {
    const steps = collected.map(stepFromEntry);
    const fields = flattenFields(collected, steps);
    const attachments = gatherAttachments(collected);
    const summary = formSummary(steps, collected, fields, attachments);
    const issues = fieldIssues(fields).concat(stepIssues(collected, steps));

    if (fields.length === 0 && steps.length > 0) {
      issues.push({
        severity: "warning",
        code: "no-fields",
        message: "Nenhum campo de formulário foi identificado nos passos coletados.",
      });
    }

    finalizeSummary(summary, issues);

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
      generatedAt: createdAt(now),
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

  // ------------------------------------------------------------------- selection

  function buildReport(doc, location, collected, mode, kind, now) {
    const hasFields = collected.some((entry) => (entry.fields || []).length > 0);
    const hasItems = collected.some((entry) => (entry.items || []).length > 0);

    // Mixed content (wizard with checklist steps and plain fields): keep the form view
    // since it already groups everything by step/section.
    if (hasItems && !hasFields) return buildChecklistReport(doc, location, collected, mode, now);
    if (hasFields) return buildFormReport(doc, location, collected, mode, kind, now);

    return kind === "checklist"
      ? buildChecklistReport(doc, location, collected, mode, now)
      : buildFormReport(doc, location, collected, mode, kind, now);
  }

  return { buildChecklistReport, buildFormReport, buildReport };
});
