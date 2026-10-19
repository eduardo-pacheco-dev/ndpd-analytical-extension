// Popup pure helpers: progress estimation, CSV/JSON export building and file naming.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.popup = ndpd.popup || {};
  ndpd.popup.format = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // Estimates an overall completion (0-99%) from the nested level trail
  // (e.g. wizard step 2/5, section 1/3), including the current item's sub-progress (0-1).
  function overallPercent(trail) {
    if (!trail || !trail.length) return 0;
    let cum = 1;
    let sum = 0;
    for (const level of trail) {
      cum *= Math.max(1, level.total || 1);
      const position = Math.max(0, (level.current || 1) - 1) + Math.min(1, Math.max(0, level.sub || 0));
      sum += position / cum;
    }
    return Math.min(99, Math.round(sum * 100));
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (/[";\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csvDocument(rows) {
    return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  }

  function buildFormCsvRows(result) {
    const rows = [["Passo", "Campo", "Tipo", "Obrigatorio", "Preenchido", "Valor", "Problemas"]];
    for (const field of result.fields || []) {
      const issues = (result.issues || [])
        .filter((issue) => issue.itemName === field.stepLabel && issue.message.includes(field.label))
        .map((issue) => issue.message);
      rows.push([
        field.stepLabel,
        field.label,
        field.typeLabel || field.type,
        field.required ? "Sim" : "Nao",
        field.filled ? "Sim" : "Nao",
        field.value || "",
        issues.join(" | "),
      ]);
    }
    return rows;
  }

  function buildChecklistCsvRows(result) {
    const rows = [
      ["Secao", "Item", "Obrigatoriedade", "Status", "Resposta", "Anexos", "Anexos rejeitados", "Anexos sem nome", "Campos", "Problemas"],
    ];
    for (const item of result.items || []) {
      rows.push([
        (item.sectionCode ? item.sectionCode + " " : "") + item.sectionLabel,
        "#" + item.index + " " + item.name,
        item.requirementLabel,
        item.statusLabel || item.status,
        item.radio && item.radio.answer ? item.radio.answer : "",
        item.attachments
          .map(
            (attachment) =>
              (attachment.name || "(sem nome)") + " [" + (attachment.statusLabel || attachment.status) + "]"
          )
          .join(" | "),
        item.attachments.filter((attachment) => attachment.status === "rejected").length,
        item.attachments.filter((attachment) => !attachment.name).length,
        item.inputs
          .filter((input) => input.value)
          .map((input) => (input.label ? input.label + "=" : "") + input.value)
          .join(" | "),
        item.issues.map((issue) => issue.message).join(" | "),
      ]);
    }
    return rows;
  }

  function csvRows(result) {
    return result.kind === "checklist" ? buildChecklistCsvRows(result) : buildFormCsvRows(result);
  }

  function timestamp(date) {
    return (date || new Date()).toISOString().replace(/[:.]/g, "-");
  }

  function fileStem(result, date) {
    const order = result.workOrder || {};
    const parts = ["ndpd-analise"];
    if (order.number) parts.push(order.number);
    if (order.smpId) parts.push(order.smpId);
    parts.push(timestamp(date));
    return parts.join("_").replace(/[^\w\-]+/g, "-");
  }

  function buildCsvExport(result, date) {
    if (!result) return null;
    return {
      filename: fileStem(result, date) + ".csv",
      content: csvDocument(csvRows(result)),
      mime: "text/csv;charset=utf-8",
    };
  }

  function buildJsonExport(result, date) {
    if (!result) return null;
    return {
      filename: fileStem(result, date) + ".json",
      content: JSON.stringify(result, null, 2),
      mime: "application/json",
    };
  }

  return {
    overallPercent,
    csvCell,
    csvDocument,
    buildFormCsvRows,
    buildChecklistCsvRows,
    csvRows,
    timestamp,
    fileStem,
    buildCsvExport,
    buildJsonExport,
  };
});
