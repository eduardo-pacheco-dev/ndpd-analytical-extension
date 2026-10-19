// Popup view layer: renders the dashboard and manages popup-only DOM concerns.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.popup = ndpd.popup || {};
  ndpd.popup.ui = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const STATUS_COLORS = {
    accepted: "#34d399",
    rejected: "#f87171",
    pending: "#fbbf24",
    performed: "#60a5fa",
    awaiting: "#a78bfa",
    other: "#8ea3c0",
  };

  const ISSUE_LABELS = {
    "item-rejected": "Item rejeitado",
    "item-pending": "Item pendente",
    "item-no-status": "Item sem status",
    "required-unanswered": "Obrigatório sem aceite",
    "radio-unanswered": "Pergunta sem resposta",
    "input-required-empty": "Campo obrigatório vazio",
    "required-field-empty": "Campo obrigatório vazio",
    "select-empty": "Seleção não preenchida",
    "no-fields": "Sem campos identificados",
    "step-not-loaded": "Passo não carregado",
    "attachment-missing": "Evidência sem anexo",
    "attachment-rejected": "Anexo rejeitado",
    "attachment-unnamed": "Anexo sem nome",
    "attachment-duplicate": "Anexo duplicado",
    "badge-mismatch-accepted": "Divergência no badge (aceitos)",
    "badge-mismatch-total": "Divergência no badge (total)",
    "section-not-loaded": "Seção não carregada",
    "no-items": "Sem itens no DOM",
  };

  const ISSUE_LIMIT = 8;
  const ITEM_LIMIT = 8;
  const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
  const SEVERITY_COLORS = { error: "#f87171", warning: "#fbbf24", info: "#60a5fa" };

  // Mounts the dashboard over an existing popup document.
  function createDashboard(document) {
    const els = {
      status: document.getElementById("status"),
      error: document.getElementById("error"),
      result: document.getElementById("result"),
      idle: document.getElementById("idle"),
      workorder: document.getElementById("workorder"),
      kpis: document.getElementById("kpis"),
      donut: document.getElementById("donut"),
      legend: document.getElementById("legend"),
      sectionBars: document.getElementById("section-bars"),
      issueBars: document.getElementById("issue-bars"),
      issues: document.getElementById("issues"),
      issuesCount: document.getElementById("issues-count"),
      items: document.getElementById("items"),
      itemsCount: document.getElementById("items-count"),
      itemsTitle: document.getElementById("items-title"),
      barsTitle: document.getElementById("bars-title"),
      donutTitle: document.getElementById("donut-title"),
      notes: document.getElementById("notes"),
      jsonBtn: document.getElementById("export-json"),
      csvBtn: document.getElementById("export-csv"),
      refreshBtn: document.getElementById("refresh"),
      activeBtn: document.getElementById("analyze-active"),
      allBtn: document.getElementById("analyze-all"),
      progress: document.getElementById("progress"),
      progressFill: document.getElementById("progress-fill"),
      progressPath: document.getElementById("progress-path"),
      progressPct: document.getElementById("progress-pct"),
    };

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function svgNode(tag, attrs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const key of Object.keys(attrs || {})) node.setAttribute(key, attrs[key]);
      return node;
    }

    function setLoading(isLoading, message, hasResult) {
      els.refreshBtn.disabled = isLoading;
      els.activeBtn.disabled = isLoading;
      els.allBtn.disabled = isLoading;
      els.jsonBtn.disabled = isLoading || !hasResult;
      els.csvBtn.disabled = isLoading || !hasResult;
      if (message) els.status.textContent = message;
    }

    function showProgress(path, percent, options) {
      const opts = options || {};
      els.progress.classList.remove("hidden");
      els.progress.classList.toggle("indeterminate", Boolean(opts.indeterminate));
      els.progress.classList.toggle("done", Boolean(opts.done));
      els.progressPath.textContent = path || "Coletando…";
      els.progressPct.textContent = opts.indeterminate ? "…" : percent != null ? percent + "%" : "";
      els.progressFill.style.width = opts.indeterminate ? "35%" : percent != null ? percent + "%" : "0%";
    }

    function hideProgress() {
      els.progress.classList.add("hidden");
      els.progress.classList.remove("indeterminate", "done");
    }

    function renderError(message) {
      if (els.idle) els.idle.classList.add("hidden");
      els.result.classList.add("hidden");
      els.error.classList.remove("hidden");
      els.error.textContent = "";
      els.error.appendChild(el("strong", null, "Não foi possível analisar"));
      els.error.appendChild(el("span", null, message));
    }

    function summaryOf(data) {
      return data.summary || {};
    }

    function renderWorkOrder(data) {
      els.workorder.textContent = "";
      const order = data.workOrder || {};
      const titleParts = [];
      if (order.number) titleParts.push(order.number);
      if (order.name) titleParts.push(order.name);
      els.workorder.appendChild(
        el(
          "div",
          "wo-title",
          titleParts.length ? titleParts.join(" · ") : order.header || "Execução sem identificação"
        )
      );

      const isForm = data.kind !== "checklist";
      const collected = isForm
        ? (data.summary.stepsCollected || 0) + "/" + (data.summary.steps || 0) + " passos"
        : (data.summary.sectionsCollected || 0) + "/" + (data.summary.sections || 0) + " seções";

      const meta = [];
      if (order.header && order.header !== titleParts.join(" · ")) meta.push(order.header);
      if (order.smpId) meta.push(order.smpId);
      meta.push(collected);
      meta.push(isForm ? (data.kind === "form-tabs" ? "formulário (abas)" : "formulário (passos)") : "checklist");
      els.workorder.appendChild(el("div", "wo-meta", meta.join("  •  ")));
    }

    function renderKpis(target, cards) {
      target.textContent = "";
      for (const [label, value, tone, hint] of cards) target.appendChild(kpiCard(label, value, tone, hint));
    }

    function kpiCard(label, value, tone, hint) {
      const card = el("div", "kpi" + (tone ? " " + tone : ""));
      card.appendChild(el("div", "num", String(value)));
      card.appendChild(el("div", "lbl", label));
      if (hint) card.appendChild(el("div", "hint", hint));
      return card;
    }

    function renderDonut(segmentsInput, total, centerLabel) {
      els.donut.textContent = "";
      els.legend.textContent = "";

      const size = 132;
      const stroke = 17;
      const radius = (size - stroke) / 2;
      const center = size / 2;
      const circumference = 2 * Math.PI * radius;

      const svg = svgNode("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
      svg.appendChild(
        svgNode("circle", {
          cx: center,
          cy: center,
          r: radius,
          fill: "none",
          stroke: "rgba(96,128,175,0.18)",
          "stroke-width": stroke,
        })
      );

      const segments = segmentsInput.filter((segment) => segment.value > 0);
      let offset = 0;
      for (const segment of segments) {
        const length = total > 0 ? (circumference * segment.value) / total : 0;
        svg.appendChild(
          svgNode("circle", {
            cx: center,
            cy: center,
            r: radius,
            fill: "none",
            stroke: segment.color,
            "stroke-width": stroke,
            "stroke-dasharray": `${length} ${circumference - length}`,
            "stroke-dashoffset": -offset,
            transform: `rotate(-90 ${center} ${center})`,
          })
        );
        offset += length;
      }

      const mainValue = total > 0 ? Math.round(((segmentsInput[0] ? segmentsInput[0].value : 0) / total) * 100) : 0;
      const big = svgNode("text", {
        x: center,
        y: center + 2,
        "text-anchor": "middle",
        "font-size": 26,
        "font-weight": 750,
        fill: "#e6edf7",
      });
      big.textContent = mainValue + "%";
      svg.appendChild(big);

      const small = svgNode("text", {
        x: center,
        y: center + 17,
        "text-anchor": "middle",
        "font-size": 8.5,
        fill: "#8ea3c0",
      });
      small.textContent = centerLabel;
      svg.appendChild(small);

      els.donut.appendChild(svg);

      segmentsInput.forEach((segment, index) => {
        if (!segment.value && index !== 0) return;
        const item = el("li");
        const dot = el("span", "dot");
        dot.style.background = segment.color;
        item.appendChild(dot);
        item.appendChild(el("span", null, segment.label));
        item.appendChild(
          el("span", "val", segment.value + " • " + (total ? Math.round((segment.value / total) * 100) : 0) + "%")
        );
        els.legend.appendChild(item);
      });
    }

    function barRow(label, valueText, segments) {
      const row = el("div", "bar-row");
      const top = el("div", "bar-top");
      top.appendChild(el("span", "label", label));
      top.appendChild(el("span", "value", valueText));
      row.appendChild(top);

      const track = el("div", "track");
      for (const segment of segments) {
        if (!segment.value) continue;
        const piece = el("span");
        piece.style.background = segment.color;
        piece.style.width = segment.percent + "%";
        piece.title = segment.title || "";
        track.appendChild(piece);
      }
      row.appendChild(track);
      return row;
    }

    function renderSectionBars(data) {
      els.sectionBars.textContent = "";
      const sections = data.sections || [];
      if (sections.length === 0) {
        els.sectionBars.appendChild(el("div", "empty", "Nenhuma seção encontrada."));
        return;
      }

      for (const section of sections) {
        const counts = section.counts || { accepted: 0, total: 0 };
        const total = counts.total || 0;
        const items = (data.items || []).filter(
          (item) => item.sectionCode === section.code && item.sectionLabel === section.label
        );
        const rejected = items.filter((item) => item.status === "rejected").length;
        const pending = items.filter((item) => item.status === "pending").length;
        const other = Math.max(0, total - counts.accepted - rejected - pending);
        const percent = (value) => (total > 0 ? (value / total) * 100 : 0);

        els.sectionBars.appendChild(
          barRow(
            (section.code ? section.code + " " : "") + section.name,
            total > 0 ? counts.accepted + "/" + total + " aceitos" : section.badge || "não coletada",
            [
              { value: counts.accepted, percent: percent(counts.accepted), color: STATUS_COLORS.accepted, title: "aceitos" },
              { value: pending, percent: percent(pending), color: STATUS_COLORS.pending, title: "pendentes" },
              { value: rejected, percent: percent(rejected), color: STATUS_COLORS.rejected, title: "rejeitados" },
              { value: other, percent: percent(other), color: STATUS_COLORS.other, title: "outros" },
            ]
          )
        );
      }
    }

    function renderStepBars(data) {
      els.sectionBars.textContent = "";
      const steps = data.steps || [];
      if (steps.length === 0) {
        els.sectionBars.appendChild(el("div", "empty", "Nenhum passo encontrado."));
        return;
      }

      for (const step of steps) {
        const counts = step.counts || { total: 0, filled: 0, requiredEmpty: 0 };
        const total = counts.total || 0;
        const filled = counts.filled || 0;
        const requiredEmpty = counts.requiredEmpty || 0;
        const optionalEmpty = Math.max(0, total - filled - requiredEmpty);
        const percent = (value) => (total > 0 ? (value / total) * 100 : 0);

        els.sectionBars.appendChild(
          barRow(
            step.label || step.name || "Passo",
            total > 0 ? filled + "/" + total + " preenchidos" : "não coletado",
            [
              { value: filled, percent: percent(filled), color: STATUS_COLORS.accepted, title: "preenchidos" },
              { value: requiredEmpty, percent: percent(requiredEmpty), color: STATUS_COLORS.rejected, title: "obrigatórios vazios" },
              { value: optionalEmpty, percent: percent(optionalEmpty), color: STATUS_COLORS.pending, title: "opcionais vazios" },
            ]
          )
        );
      }
    }

    function renderSteps(steps, fields) {
      els.items.textContent = "";
      els.itemsCount.textContent = String(fields.length);

      if (!steps.length) {
        els.items.appendChild(el("div", "empty", "Nenhum passo coletado."));
        return;
      }

      for (const step of steps) {
        const stepFields = fields.filter((field) => field.stepIndex === step.index + 1);
        const counts = step.counts || {};
        const requiredEmpty = counts.requiredEmpty || 0;
        const complete = (counts.total || 0) > 0 && (counts.filled || 0) === counts.total;

        const card = el("details", "item");
        if (steps.length === 1 || requiredEmpty > 0) card.open = true;

        const summary = el("summary");
        summary.appendChild(el("span", "dot " + (requiredEmpty ? "rejected" : complete ? "accepted" : "performed")));

        const main = el("div", "item-main");
        main.appendChild(el("span", "item-name", step.label || step.name || "Passo"));

        const sub = el("div", "item-sub");
        sub.appendChild(el("span", "pill", (counts.filled || 0) + "/" + (counts.total || 0) + " preenchidos"));
        if (counts.required) sub.appendChild(el("span", "pill req", counts.required + " obrigatório(s)"));
        if (requiredEmpty) sub.appendChild(el("span", "pill", requiredEmpty + " vazio(s)"));
        main.appendChild(sub);

        summary.appendChild(main);
        card.appendChild(summary);

        const body = el("div", "item-body");
        if (stepFields.length === 0) {
          body.appendChild(el("div", "kv", "Nenhum campo identificado neste passo."));
        }
        for (const field of stepFields) {
          const row = el("div", "kv");
          row.title = field.typeLabel || "";
          row.appendChild(el("span", "k", field.label + (field.required ? " *" : "")));
          const value = el("span", "v", field.value || "—");
          if (!field.filled) value.style.color = field.required ? "#fca5a5" : "#fde68a";
          row.appendChild(value);
          body.appendChild(row);
        }
        card.appendChild(body);
        els.items.appendChild(card);
      }
    }

    function renderIssueBars(issues) {
      els.issueBars.textContent = "";
      const counts = new Map();
      for (const issue of issues || []) {
        const entry = counts.get(issue.code) || { count: 0, severity: issue.severity };
        entry.count += 1;
        if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[entry.severity]) entry.severity = issue.severity;
        counts.set(issue.code, entry);
      }

      if (counts.size === 0) {
        els.issueBars.appendChild(el("div", "empty", "Nenhum problema detectado."));
        return;
      }

      const entries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
      const max = entries[0][1].count;
      for (const [code, entry] of entries) {
        els.issueBars.appendChild(
          barRow(ISSUE_LABELS[code] || code, entry.count + "x", [
            {
              value: entry.count,
              percent: (entry.count / max) * 100,
              color: SEVERITY_COLORS[entry.severity],
              title: entry.severity,
            },
          ])
        );
      }
    }

    function renderIssues(issues) {
      els.issues.textContent = "";
      els.issuesCount.textContent = String((issues || []).length);

      if (!issues || issues.length === 0) {
        els.issues.appendChild(el("div", "empty", "Nenhuma validação apontou problema."));
        return;
      }

      const sorted = issues
        .slice()
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

      const draw = (limit) => {
        els.issues.textContent = "";
        for (const issue of (limit ? sorted.slice(0, limit) : sorted)) {
          const row = el("div", "issue " + issue.severity);
          row.appendChild(
            el(
              "span",
              "tag",
              issue.severity === "error" ? "Erro" : issue.severity === "warning" ? "Alerta" : "Info"
            )
          );
          const body = el("div");
          body.appendChild(el("span", null, issue.message));
          const where = [];
          if (issue.section) where.push(issue.section);
          if (issue.itemName) where.push("#" + issue.itemIndex + " " + issue.itemName);
          if (where.length) body.appendChild(el("span", "where", where.join("  •  ")));
          row.appendChild(body);
          els.issues.appendChild(row);
        }

        if (limit && sorted.length > limit) {
          const button = el("button", "show-more", "Mostrar todos os " + sorted.length + " problemas");
          button.addEventListener("click", () => draw(0));
          els.issues.appendChild(button);
        }
      };

      draw(sorted.length > ISSUE_LIMIT ? ISSUE_LIMIT : 0);
    }

    function detail(key, value) {
      const box = el("div", "kv");
      box.appendChild(el("span", "k", key));
      box.appendChild(el("span", "v", value));
      return box;
    }

    function itemNode(item) {
      const details = el("details", "item");

      const summary = el("summary");
      summary.appendChild(el("span", "dot " + item.status));

      const main = el("div", "item-main");
      main.appendChild(el("span", "item-name", "#" + item.index + "  " + item.name));

      const sub = el("div", "item-sub");
      if (item.sectionCode) sub.appendChild(el("span", "pill", item.sectionCode));
      sub.appendChild(el("span", "pill", item.statusLabel || item.status));
      sub.appendChild(
        el("span", "pill " + (item.requirement === "required" ? "req" : ""), item.requirementLabel)
      );
      if (item.radio && item.radio.answer) sub.appendChild(el("span", "pill", "Resposta: " + item.radio.answer));
      if (item.attachments.length) sub.appendChild(el("span", "pill", item.attachments.length + " anexo(s)"));
      if (item.issues.length) sub.appendChild(el("span", "pill", item.issues.length + " problema(s)"));
      main.appendChild(sub);

      summary.appendChild(main);
      details.appendChild(summary);

      const body = el("div", "item-body");
      if (item.sectionLabel) body.appendChild(detail("Seção", item.sectionLabel));

      if (item.radio) {
        body.appendChild(
          detail(
            "Pergunta",
            item.radio.answer
              ? item.radio.answer + (item.radio.disabled ? " (somente leitura)" : "")
              : "Sem opção selecionada — opções: " + item.radio.options.join(" / ")
          )
        );
      }

      const filledInputs = item.inputs.filter((input) => input.value);
      if (filledInputs.length) {
        body.appendChild(
          detail(
            "Campos",
            filledInputs.map((input) => (input.label ? input.label + " = " : "") + input.value).join("  •  ")
          )
        );
      }

      if (item.attachments.length) {
        body.appendChild(el("span", "k", "Evidências"));
        const thumbs = el("div", "thumbs");
        for (const attachment of item.attachments) {
          if (!attachment.src) continue;
          const img = el("img", "thumb");
          img.src = attachment.src;
          img.alt = attachment.name || "anexo";
          img.title = (attachment.name || "anexo") + " — " + attachment.statusLabel;
          thumbs.appendChild(img);
        }
        body.appendChild(thumbs);

        const list = el("ul");
        for (const attachment of item.attachments) {
          const li = el("li", attachment.status === "rejected" ? "error" : null);
          li.textContent =
            (attachment.name || "(sem nome)") + " — " + (attachment.statusLabel || attachment.status);
          list.appendChild(li);
        }
        body.appendChild(list);
      }

      if (item.issues.length) {
        const list = el("ul");
        for (const issue of item.issues) {
          const li = el("li", issue.severity);
          li.textContent = issue.message;
          list.appendChild(li);
        }
        body.appendChild(list);
      } else {
        body.appendChild(el("div", "kv", "Sem problemas identificados neste item."));
      }

      details.appendChild(body);
      return details;
    }

    function renderItems(items) {
      els.items.textContent = "";
      els.itemsCount.textContent = String((items || []).length);

      if (!items || items.length === 0) {
        els.items.appendChild(el("div", "empty", "Nenhum caso de teste encontrado."));
        return;
      }

      const draw = (limit) => {
        els.items.textContent = "";
        for (const item of (limit ? items.slice(0, limit) : items)) els.items.appendChild(itemNode(item));
        if (limit && items.length > limit) {
          const button = el("button", "show-more", "Mostrar todos os " + items.length + " itens");
          button.addEventListener("click", () => draw(0));
          els.items.appendChild(button);
        }
      };

      draw(items.length > ITEM_LIMIT ? ITEM_LIMIT : 0);
    }

    function renderNotes(notes) {
      els.notes.textContent = "";
      for (const note of notes || []) els.notes.appendChild(el("li", null, note));
    }

    function renderChecklist(data) {
      const statusCounts = { accepted: 0, rejected: 0, pending: 0, performed: 0, awaiting: 0, other: 0 };
      for (const item of data.items) {
        if (statusCounts[item.status] === undefined || item.status === "unknown") statusCounts.other += 1;
        else statusCounts[item.status] += 1;
      }
      const total = data.items.length;

      renderKpis(
        els.kpis,
        [
          ["Itens", summaryOf(data).items, null, summaryOf(data).required + " obrigatórios"],
          ["Aceitos", statusCounts.accepted, "ok", (total ? Math.round((statusCounts.accepted / total) * 100) : 0) + "% do total"],
          ["Rejeitados", statusCounts.rejected, statusCounts.rejected ? "err" : null, "requer atenção"],
          ["Pendentes", statusCounts.pending, statusCounts.pending ? "warn" : null, "não finalizados"],
        ]
      );

      renderDonut(
        [
          { key: "accepted", label: "Aceitos", value: statusCounts.accepted, color: STATUS_COLORS.accepted },
          { key: "pending", label: "Pendentes", value: statusCounts.pending, color: STATUS_COLORS.pending },
          { key: "awaiting", label: "Aguardando avaliação", value: statusCounts.awaiting, color: STATUS_COLORS.awaiting },
          { key: "rejected", label: "Rejeitados", value: statusCounts.rejected, color: STATUS_COLORS.rejected },
          { key: "performed", label: "Executados", value: statusCounts.performed, color: STATUS_COLORS.performed },
          { key: "other", label: "Sem status", value: statusCounts.other, color: STATUS_COLORS.other },
        ],
        total,
        "aceites"
      );

      renderSectionBars(data);
      renderItems(data.items);
    }

    function renderForm(data) {
      const summary = data.summary || {};
      const fields = data.fields || [];
      const filled = summary.filled || 0;
      const requiredEmpty = summary.requiredEmpty || 0;
      const emptyOptional = Math.max(0, fields.length - filled - requiredEmpty);

      renderKpis(
        els.kpis,
        [
          ["Passos", summary.steps || 0, null, (summary.stepsCollected || 0) + " coletados"],
          ["Campos", fields.length, null, summary.required + " obrigatórios"],
          ["Preenchidos", filled, "ok", (fields.length ? Math.round((filled / fields.length) * 100) : 0) + "% do total"],
          ["Vazios", fields.length - filled, requiredEmpty ? "err" : fields.length - filled ? "warn" : null, requiredEmpty + " obrigatório(s)"],
        ]
      );

      renderDonut(
        [
          { key: "filled", label: "Preenchidos", value: filled, color: STATUS_COLORS.accepted },
          { key: "requiredEmpty", label: "Vazios obrigatórios", value: requiredEmpty, color: STATUS_COLORS.rejected },
          { key: "emptyOptional", label: "Vazios opcionais", value: emptyOptional, color: STATUS_COLORS.pending },
        ],
        fields.length,
        "preenchidos"
      );

      renderStepBars(data);
      renderSteps(data.steps || [], fields);
    }

    function render(data) {
      els.error.classList.add("hidden");
      els.result.classList.remove("hidden");
      renderWorkOrder(data);

      const isForm = data.kind !== "checklist";
      els.donutTitle.textContent = isForm ? "Preenchimento" : "Status dos itens";
      els.barsTitle.textContent = isForm ? "Progresso por passo" : "Progresso por seção";
      els.itemsTitle.textContent = isForm ? "Passos e campos" : "Casos de teste";

      if (isForm) renderForm(data);
      else renderChecklist(data);

      renderIssueBars(data.issues);
      renderIssues(data.issues);
      renderNotes(data.notes);
    }

    function downloadFile(filename, content, mime) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    return {
      elements: els,
      setLoading,
      showProgress,
      hideProgress,
      render,
      renderError,
      downloadFile,
    };
  }

  return { createDashboard, STATUS_COLORS, ISSUE_LABELS, SEVERITY_ORDER };
});
