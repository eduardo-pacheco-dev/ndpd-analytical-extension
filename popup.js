// Popup script — analyzes the NDPd tab and renders the visual dashboard.
const NDPD_HOST_PATTERN = /(^|\.)deliveryplatform\.nokia\.com$/i;
const SVG_NS = "http://www.w3.org/2000/svg";

const STATUS_COLORS = {
  accepted: "#34d399",
  rejected: "#f87171",
  pending: "#fbbf24",
  performed: "#60a5fa",
  other: "#8ea3c0",
};

const STATUS_LABELS = {
  accepted: "Aceitos",
  rejected: "Rejeitados",
  pending: "Pendentes",
  performed: "Executados",
  other: "Sem status",
};

const ISSUE_LABELS = {
  "item-rejected": "Item rejeitado",
  "item-pending": "Item pendente",
  "item-no-status": "Item sem status",
  "required-unanswered": "Obrigatório sem aceite",
  "radio-unanswered": "Pergunta sem resposta",
  "input-required-empty": "Campo obrigatório vazio",
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

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const resultEl = document.getElementById("result");
const workorderEl = document.getElementById("workorder");
const kpisEl = document.getElementById("kpis");
const donutEl = document.getElementById("donut");
const legendEl = document.getElementById("legend");
const sectionBarsEl = document.getElementById("section-bars");
const issueBarsEl = document.getElementById("issue-bars");
const issuesEl = document.getElementById("issues");
const issuesCountEl = document.getElementById("issues-count");
const itemsEl = document.getElementById("items");
const itemsCountEl = document.getElementById("items-count");
const notesEl = document.getElementById("notes");
const jsonBtn = document.getElementById("export-json");
const csvBtn = document.getElementById("export-csv");
const refreshBtn = document.getElementById("refresh");
const activeBtn = document.getElementById("analyze-active");
const allBtn = document.getElementById("analyze-all");

let currentResult = null;
let collecting = false;

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

function queryTabs(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      resolve(tabs || []);
    });
  });
}

function tabHost(tab) {
  if (!tab || !tab.url) return null;
  try {
    return new URL(tab.url).hostname;
  } catch (error) {
    return null;
  }
}

async function getActiveTab() {
  const activeTabs = await queryTabs({ active: true, currentWindow: true });
  const activeTab = activeTabs[0];
  if (activeTab && NDPD_HOST_PATTERN.test(tabHost(activeTab) || "")) return activeTab;

  let ndpdTabs = [];
  try {
    ndpdTabs = await queryTabs({ url: "https://*.deliveryplatform.nokia.com/*" });
  } catch (error) {
    ndpdTabs = [];
  }
  if (ndpdTabs.length > 0) {
    const sameWindow = ndpdTabs.find((tab) => activeTab && tab.windowId === activeTab.windowId);
    return sameWindow || ndpdTabs[0];
  }

  if (!activeTab) throw new Error("Nenhuma aba ativa encontrada.");
  return activeTab;
}

function sendAnalyze(tabId, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Tempo esgotado ao aguardar a página (coleta muito longa ou página travada)."));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, { type }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!response) return reject(new Error("A página não respondeu."));
      if (!response.ok) {
        const failure = new Error(response.error || "Falha na análise.");
        failure.analysis = true;
        return reject(failure);
      }
      resolve(response.data);
    });
  });
}

function injectAnalyzer(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["analyzer.js", "content.js"] },
      () => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve();
      }
    );
  });
}

function friendlyError(tab, error) {
  const host = tabHost(tab);
  if (host && !NDPD_HOST_PATTERN.test(host)) {
    return "A aba ativa não é do NDPd (" + host + "). Abra a tela de execução do checklist e tente novamente.";
  }
  const message = error && error.message ? error.message : String(error);
  if (/cannot access|not allowed|extension manifest/i.test(message)) {
    return "Sem permissão para ler esta página. Confirme que a URL é do NDPd e recarregue a extensão.";
  }
  if (/message port closed|receiving end does not exist/i.test(message)) {
    return (
      "A página está com uma versão antiga do content script. Recarregue a aba do NDPd (F5) " +
      "e clique em Coletar tudo."
    );
  }
  return (
    "Não foi possível ler a página do NDPd (" +
    message +
    "). Recarregue a aba (F5) e clique em Analisar."
  );
}

async function analyze(mode) {
  const type = mode === "active" ? "NDPD_ANALYZE" : "NDPD_ANALYZE_ALL";
  const timeout = type === "NDPD_ANALYZE_ALL" ? 180000 : 30000;
  setLoading(true, mode === "active" ? "Analisando a seção ativa…" : "Coletando todas as seções…");
  collecting = true;

  try {
    const tab = await getActiveTab();
    if (tab.id == null) throw new Error("Não foi possível identificar a aba ativa.");
    const host = tabHost(tab);
    console.info("[NDPd Analytical] analisando aba", tab.id, host || "(host indisponível)", type);

    if (host && !NDPD_HOST_PATTERN.test(host)) {
      throw new Error(
        "A aba ativa não é do NDPd (" + host + "). Abra a tela de execução do checklist."
      );
    }

    let data;
    try {
      data = await sendAnalyze(tab.id, type, timeout);
    } catch (firstError) {
      if (firstError.analysis) throw firstError;
      console.info("[NDPd Analytical] primeira tentativa falhou, injetando content script:", firstError.message);

      try {
        await injectAnalyzer(tab.id);
        data = await sendAnalyze(tab.id, type, timeout);
      } catch (secondError) {
        throw new Error(friendlyError(tab, secondError));
      }
    }

    currentResult = data;
    render(data);
    setLoading(false, "Análise atualizada às " + new Date().toLocaleTimeString("pt-BR"));
    console.info(
      "[NDPd Analytical] relatório pronto:",
      data.summary.items,
      "itens,",
      data.summary.sectionsCollected + "/" + data.summary.sections,
      "seções coletadas"
    );
  } catch (error) {
    currentResult = null;
    renderError(error.message || String(error));
    setLoading(false, "Falha na análise");
    console.warn("[NDPd Analytical] falha:", error.message || String(error));
  } finally {
    collecting = false;
  }
}

function setLoading(isLoading, message) {
  refreshBtn.disabled = isLoading;
  activeBtn.disabled = isLoading;
  allBtn.disabled = isLoading;
  jsonBtn.disabled = isLoading || !currentResult;
  csvBtn.disabled = isLoading || !currentResult;
  if (message) statusEl.textContent = message;
}

function renderError(message) {
  resultEl.classList.add("hidden");
  errorEl.classList.remove("hidden");
  errorEl.textContent = "";
  errorEl.appendChild(el("strong", null, "Não foi possível analisar"));
  errorEl.appendChild(el("span", null, message));
}

function render(data) {
  errorEl.classList.add("hidden");
  resultEl.classList.remove("hidden");

  const statusCounts = { accepted: 0, rejected: 0, pending: 0, performed: 0, other: 0 };
  for (const item of data.items) {
    if (statusCounts[item.status] === undefined || item.status === "unknown") statusCounts.other += 1;
    else statusCounts[item.status] += 1;
  }
  const total = data.items.length;

  renderWorkOrder(data);
  renderKpis(data, statusCounts, total);
  renderDonut(statusCounts, total);
  renderSectionBars(data);
  renderIssueBars(data.issues);
  renderIssues(data.issues);
  renderItems(data.items);
  renderNotes(data.notes);
}

function renderWorkOrder(data) {
  workorderEl.textContent = "";
  const order = data.workOrder || {};
  const titleParts = [];
  if (order.number) titleParts.push(order.number);
  if (order.name) titleParts.push(order.name);
  workorderEl.appendChild(
    el("div", "wo-title", titleParts.length ? titleParts.join(" · ") : order.header || "Checklist sem identificação")
  );

  const meta = [];
  if (order.header && order.header !== titleParts.join(" · ")) meta.push(order.header);
  if (order.smpId) meta.push(order.smpId);
  meta.push(data.summary.sectionsCollected + "/" + data.summary.sections + " seções");
  meta.push(data.mode === "all" ? "coleta completa" : "seção ativa");
  workorderEl.appendChild(el("div", "wo-meta", meta.join("  •  ")));
}

function kpiCard(label, value, tone, hint) {
  const card = el("div", "kpi" + (tone ? " " + tone : ""));
  card.appendChild(el("div", "num", String(value)));
  card.appendChild(el("div", "lbl", label));
  if (hint) card.appendChild(el("div", "hint", hint));
  return card;
}

function renderKpis(data, counts, total) {
  const summary = data.summary;
  const acceptance = total > 0 ? Math.round((counts.accepted / total) * 100) : 0;
  kpisEl.textContent = "";
  kpisEl.appendChild(kpiCard("Itens", summary.items, null, summary.required + " obrigatórios"));
  kpisEl.appendChild(kpiCard("Aceitos", counts.accepted, "ok", acceptance + "% do total"));
  kpisEl.appendChild(kpiCard("Rejeitados", counts.rejected, counts.rejected ? "err" : null, "requer atenção"));
  kpisEl.appendChild(kpiCard("Pendentes", counts.pending, counts.pending ? "warn" : null, "não finalizados"));
  kpisEl.appendChild(
    kpiCard("Anexos", summary.attachments, null, summary.attachmentsRejected + " rejeitado(s)")
  );
  kpisEl.appendChild(
    kpiCard(
      "Problemas",
      summary.issues,
      summary.errors ? "err" : summary.warnings ? "warn" : "ok",
      summary.errors + " erro(s) • " + summary.warnings + " alerta(s)"
    )
  );
}

function renderDonut(counts, total) {
  donutEl.textContent = "";
  legendEl.textContent = "";

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

  const segments = ["accepted", "rejected", "pending", "performed", "other"]
    .map((key) => ({ key, value: counts[key], color: STATUS_COLORS[key] }))
    .filter((segment) => segment.value > 0);

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

  const acceptance = total > 0 ? Math.round((counts.accepted / total) * 100) : 0;
  const big = svgNode("text", {
    x: center,
    y: center + 2,
    "text-anchor": "middle",
    "font-size": 26,
    "font-weight": 750,
    fill: "#e6edf7",
  });
  big.textContent = acceptance + "%";
  svg.appendChild(big);

  const small = svgNode("text", {
    x: center,
    y: center + 17,
    "text-anchor": "middle",
    "font-size": 8.5,
    fill: "#8ea3c0",
  });
  small.textContent = "aceites";
  svg.appendChild(small);

  donutEl.appendChild(svg);

  for (const key of ["accepted", "rejected", "pending", "performed", "other"]) {
    if (!counts[key] && key !== "accepted") continue;
    const item = el("li");
    const dot = el("span", "dot");
    dot.style.background = STATUS_COLORS[key];
    item.appendChild(dot);
    item.appendChild(el("span", null, STATUS_LABELS[key]));
    item.appendChild(
      el(
        "span",
        "val",
        counts[key] + " • " + (total ? Math.round((counts[key] / total) * 100) : 0) + "%"
      )
    );
    legendEl.appendChild(item);
  }
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
  sectionBarsEl.textContent = "";
  const sections = data.sections || [];
  if (sections.length === 0) {
    sectionBarsEl.appendChild(el("div", "empty", "Nenhuma seção encontrada."));
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

    sectionBarsEl.appendChild(
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

function renderIssueBars(issues) {
  issueBarsEl.textContent = "";
  const counts = new Map();
  for (const issue of issues || []) {
    const entry = counts.get(issue.code) || { count: 0, severity: issue.severity };
    entry.count += 1;
    if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[entry.severity]) entry.severity = issue.severity;
    counts.set(issue.code, entry);
  }

  if (counts.size === 0) {
    issueBarsEl.appendChild(el("div", "empty", "Nenhum problema detectado."));
    return;
  }

  const entries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
  const max = entries[0][1].count;
  for (const [code, entry] of entries) {
    issueBarsEl.appendChild(
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
  issuesEl.textContent = "";
  issuesCountEl.textContent = String((issues || []).length);

  if (!issues || issues.length === 0) {
    issuesEl.appendChild(el("div", "empty", "Nenhuma validação apontou problema."));
    return;
  }

  const sorted = issues
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  const draw = (limit) => {
    issuesEl.textContent = "";
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
      issuesEl.appendChild(row);
    }

    if (limit && sorted.length > limit) {
      const button = el("button", "show-more", "Mostrar todos os " + sorted.length + " problemas");
      button.addEventListener("click", () => draw(0));
      issuesEl.appendChild(button);
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
  itemsEl.textContent = "";
  itemsCountEl.textContent = String((items || []).length);

  if (!items || items.length === 0) {
    itemsEl.appendChild(el("div", "empty", "Nenhum caso de teste encontrado."));
    return;
  }

  const draw = (limit) => {
    itemsEl.textContent = "";
    for (const item of (limit ? items.slice(0, limit) : items)) itemsEl.appendChild(itemNode(item));
    if (limit && items.length > limit) {
      const button = el("button", "show-more", "Mostrar todos os " + items.length + " itens");
      button.addEventListener("click", () => draw(0));
      itemsEl.appendChild(button);
    }
  };

  draw(items.length > ITEM_LIMIT ? ITEM_LIMIT : 0);
}

function renderNotes(notes) {
  notesEl.textContent = "";
  for (const note of notes || []) notesEl.appendChild(el("li", null, note));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fileStem(result) {
  const order = result.workOrder || {};
  const parts = ["ndpd-analise"];
  if (order.number) parts.push(order.number);
  if (order.smpId) parts.push(order.smpId);
  parts.push(timestamp());
  return parts.join("_").replace(/[^\w\-]+/g, "-");
}

function download(filename, content, mime) {
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

function csvCell(value) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (/[";\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function exportCsv() {
  if (!currentResult) return;
  const rows = [
    ["Secao", "Item", "Obrigatoriedade", "Status", "Resposta", "Anexos", "Anexos rejeitados", "Anexos sem nome", "Campos", "Problemas"],
  ];

  for (const item of currentResult.items) {
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

  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  download(fileStem(currentResult) + ".csv", csv, "text/csv;charset=utf-8");
}

function exportJson() {
  if (!currentResult) return;
  download(
    fileStem(currentResult) + ".json",
    JSON.stringify(currentResult, null, 2),
    "application/json"
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "NDPD_PROGRESS" || !collecting) return;
  const progress = message.progress || {};
  if (progress.done) {
    statusEl.textContent = "Montando relatório…";
    return;
  }
  statusEl.textContent =
    "Coletando seção " + progress.current + "/" + progress.total + ": " + (progress.label || "");
});

refreshBtn.addEventListener("click", () => analyze("all"));
allBtn.addEventListener("click", () => analyze("all"));
activeBtn.addEventListener("click", () => analyze("active"));
jsonBtn.addEventListener("click", exportJson);
csvBtn.addEventListener("click", exportCsv);

analyze("all");
