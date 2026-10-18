// Dashboard page — renders the stored checklist analysis with SVG/CSS charts.
const STORAGE_KEY = "ndpdLastAnalysis";
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

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const SEVERITY_COLORS = { error: "#f87171", warning: "#fbbf24", info: "#60a5fa" };

let lastData = null;

const el = {
  meta: document.getElementById("meta"),
  empty: document.getElementById("empty"),
  content: document.getElementById("content"),
  kpis: document.getElementById("kpis"),
  donut: document.getElementById("donut"),
  legend: document.getElementById("legend"),
  sectionBars: document.getElementById("section-bars"),
  issueBars: document.getElementById("issue-bars"),
  issueSummary: document.getElementById("issue-summary"),
  issues: document.getElementById("issues"),
  issuesCount: document.getElementById("issues-count"),
  gallery: document.getElementById("gallery"),
  galleryCount: document.getElementById("gallery-count"),
  itemsBody: document.getElementById("items-body"),
  itemsCount: document.getElementById("items-count"),
  notes: document.getElementById("notes"),
  foot: document.getElementById("foot"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnPrint: document.getElementById("btn-print"),
  btnEmptyRefresh: document.getElementById("btn-empty-refresh"),
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function svgNode(tag, attrs) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs || {})) element.setAttribute(key, attrs[key]);
  return element;
}

function storageArea() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : chrome.storage.local;
}

function readStored() {
  return new Promise((resolve) => {
    storageArea().get(STORAGE_KEY, (data) => resolve(data ? data[STORAGE_KEY] : null));
  });
}

function writeStored(data) {
  return new Promise((resolve) => {
    storageArea().set({ [STORAGE_KEY]: data }, () => resolve());
  });
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

function sendAnalyze(tabId, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Tempo esgotado ao aguardar a página do NDPd."));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, { type }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!response) return reject(new Error("A página não respondeu."));
      if (!response.ok) return reject(new Error(response.error || "Falha na análise."));
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

async function findNdpdTab() {
  let tabs = [];
  try {
    tabs = await queryTabs({ url: "https://*.deliveryplatform.nokia.com/*" });
  } catch (error) {
    tabs = [];
  }
  if (tabs.length === 0) throw new Error("Nenhuma aba do NDPd aberta. Abra a tela do checklist primeiro.");
  return tabs[0];
}

async function reanalyze() {
  setStatus("Analisando a aba do NDPd…");
  try {
    const tab = await findNdpdTab();
    let data;
    try {
      data = await sendAnalyze(tab.id, "NDPD_ANALYZE_ALL", 180000);
    } catch (firstError) {
      await injectAnalyzer(tab.id);
      data = await sendAnalyze(tab.id, "NDPD_ANALYZE_ALL", 180000);
    }
    await writeStored(data);
    render(data);
    setStatus("");
  } catch (error) {
    setStatus("Falha: " + (error.message || error));
  }
}

function setStatus(message) {
  if (!message) {
    if (lastData) renderMeta(lastData);
    return;
  }
  el.meta.textContent = "";
  el.meta.appendChild(node("strong", null, message));
}

function render(data) {
  lastData = data;
  el.empty.classList.add("hidden");
  el.content.classList.remove("hidden");

  const statusCounts = { accepted: 0, rejected: 0, pending: 0, performed: 0, other: 0 };
  for (const item of data.items) {
    if (statusCounts[item.status] === undefined || item.status === "unknown") statusCounts.other += 1;
    else statusCounts[item.status] += 1;
  }
  const total = data.items.length;

  renderMeta(data);
  renderKpis(data, statusCounts, total);
  renderDonut(statusCounts, total);
  renderSectionBars(data);
  renderIssueBars(data.issues);
  renderIssueSummary(data.summary);
  renderIssues(data.issues);
  renderGallery(data.items);
  renderItems(data.items);
  renderNotes(data.notes);

  const order = data.workOrder || {};
  el.foot.textContent =
    "Gerado em " +
    new Date(data.generatedAt).toLocaleString("pt-BR") +
    " • " +
    (order.number ? order.number + " • " : "") +
    (data.mode === "all" ? "coleta completa" : "seção ativa") +
    " • " +
    data.summary.sectionsCollected +
    "/" +
    data.summary.sections +
    " seções coletadas";
}

function renderMeta(data) {
  const order = data.workOrder || {};
  el.meta.textContent = "";
  const title = node("strong", null, (order.number ? order.number + " — " : "") + (order.name || order.header || "Checklist"));
  el.meta.appendChild(title);

  const line = node("span");
  const parts = [];
  if (order.header) parts.push(order.header);
  if (order.smpId) parts.push("SMP " + order.smpId);
  parts.push(data.mode === "all" ? "coleta completa" : "seção ativa");
  line.textContent = parts.join(" • ") + " ";
  el.meta.appendChild(line);
  el.meta.appendChild(node("span", "badge-mode", data.summary.items + " itens"));
}

function kpiCard(label, value, tone, hint) {
  const card = node("div", "kpi" + (tone ? " " + tone : ""));
  card.appendChild(node("div", "num", String(value)));
  card.appendChild(node("div", "lbl", label));
  if (hint) card.appendChild(node("div", "hint", hint));
  return card;
}

function renderKpis(data, counts, total) {
  const summary = data.summary;
  const acceptance = total > 0 ? Math.round((counts.accepted / total) * 100) : 0;
  el.kpis.textContent = "";
  el.kpis.appendChild(kpiCard("Itens", summary.items, null, summary.required + " obrigatórios"));
  el.kpis.appendChild(kpiCard("Aceitos", counts.accepted, "ok", acceptance + "% do total"));
  el.kpis.appendChild(kpiCard("Rejeitados", counts.rejected, counts.rejected ? "err" : null, "requer atenção"));
  el.kpis.appendChild(kpiCard("Pendentes", counts.pending, counts.pending ? "warn" : null, "não finalizados"));
  el.kpis.appendChild(
    kpiCard("Anexos", summary.attachments, null, summary.attachmentsRejected + " rejeitado(s)")
  );
  el.kpis.appendChild(
    kpiCard(
      "Problemas",
      summary.issues,
      summary.errors ? "err" : summary.warnings ? "warn" : "ok",
      summary.errors + " erro(s) • " + summary.warnings + " alerta(s)"
    )
  );
}

function renderDonut(counts, total) {
  el.donut.textContent = "";
  el.legend.textContent = "";

  const size = 230;
  const stroke = 26;
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
    y: center - 2,
    "text-anchor": "middle",
    "font-size": 40,
    "font-weight": 750,
    fill: "#e6edf7",
  });
  big.textContent = acceptance + "%";
  svg.appendChild(big);

  const small = svgNode("text", {
    x: center,
    y: center + 24,
    "text-anchor": "middle",
    "font-size": 12,
    fill: "#8ea3c0",
  });
  small.textContent = "aceites";
  svg.appendChild(small);

  el.donut.appendChild(svg);

  for (const key of ["accepted", "rejected", "pending", "performed", "other"]) {
    if (!counts[key] && key !== "accepted") continue;
    const item = node("li");
    const dot = node("span", "dot");
    dot.style.background = STATUS_COLORS[key];
    item.appendChild(dot);
    item.appendChild(node("span", null, STATUS_LABELS[key]));
    item.appendChild(node("span", "val", counts[key] + " • " + (total ? Math.round((counts[key] / total) * 100) : 0) + "%"));
    el.legend.appendChild(item);
  }
}

function barRow(label, valueText, segments) {
  const row = node("div", "bar-row");
  const top = node("div", "bar-top");
  top.appendChild(node("span", "label", label));
  top.appendChild(node("span", "value", valueText));
  row.appendChild(top);

  const track = node("div", "track");
  for (const segment of segments) {
    if (!segment.value) continue;
    const piece = node("span");
    piece.style.background = segment.color;
    piece.style.width = segment.percent + "%";
    piece.title = segment.title || "";
    track.appendChild(piece);
  }
  row.appendChild(track);
  return row;
}

function renderSectionBars(data) {
  el.sectionBars.textContent = "";
  const sections = data.sections || [];
  if (sections.length === 0) {
    el.sectionBars.appendChild(node("div", "empty", "Nenhuma seção encontrada."));
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

    const label = (section.code ? section.code + " " : "") + section.name;
    const badge = total > 0 ? counts.accepted + "/" + total + " aceitos" : section.badge || "não coletada";
    el.sectionBars.appendChild(
      barRow(label, badge, [
        { value: counts.accepted, percent: percent(counts.accepted), color: STATUS_COLORS.accepted, title: "aceitos" },
        { value: pending, percent: percent(pending), color: STATUS_COLORS.pending, title: "pendentes" },
        { value: rejected, percent: percent(rejected), color: STATUS_COLORS.rejected, title: "rejeitados" },
        { value: other, percent: percent(other), color: STATUS_COLORS.other, title: "outros" },
      ])
    );
  }
}

function renderIssueBars(issues) {
  el.issueBars.textContent = "";
  const counts = new Map();
  for (const issue of issues || []) {
    const entry = counts.get(issue.code) || { count: 0, severity: issue.severity };
    entry.count += 1;
    if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[entry.severity]) entry.severity = issue.severity;
    counts.set(issue.code, entry);
  }

  if (counts.size === 0) {
    el.issueBars.appendChild(node("div", "empty", "Nenhum problema detectado."));
    return;
  }

  const entries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
  const max = entries[0][1].count;

  for (const [code, entry] of entries) {
    const label = ISSUE_LABELS[code] || code;
    el.issueBars.appendChild(
      barRow(label, entry.count + "x", [
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

function renderIssueSummary(summary) {
  el.issueSummary.textContent = "";
  const stats = [
    { label: "Erros", value: summary.errors, tone: "err" },
    { label: "Alertas", value: summary.warnings, tone: "warn" },
    { label: "Total", value: summary.issues, tone: "" },
  ];
  for (const stat of stats) {
    const card = node("div", "issue-stat" + (stat.tone ? " " + stat.tone : ""));
    card.appendChild(node("div", "n", String(stat.value)));
    card.appendChild(node("div", "t", stat.label));
    el.issueSummary.appendChild(card);
  }
}

function renderIssues(issues) {
  el.issues.textContent = "";
  el.issuesCount.textContent = String((issues || []).length);

  if (!issues || issues.length === 0) {
    el.issues.appendChild(node("div", "empty", "Nenhuma validação apontou problema."));
    return;
  }

  const sorted = issues
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  for (const issue of sorted) {
    const row = node("div", "issue " + issue.severity);
    row.appendChild(
      node(
        "span",
        "tag",
        issue.severity === "error" ? "Erro" : issue.severity === "warning" ? "Alerta" : "Info"
      )
    );
    const body = node("div");
    body.appendChild(node("span", null, issue.message));
    const where = [];
    if (issue.section) where.push(issue.section);
    if (issue.itemName) where.push("#" + issue.itemIndex + " " + issue.itemName);
    if (where.length) body.appendChild(node("span", "where", where.join("  •  ")));
    row.appendChild(body);
    el.issues.appendChild(row);
  }
}

function renderGallery(items) {
  el.gallery.textContent = "";
  const withAttachments = (items || []).filter((item) => item.attachments.length > 0);
  const all = withAttachments.reduce((list, item) => list.concat(item.attachments.map((a) => ({ item, attachment: a }))), []);
  el.galleryCount.textContent = String(all.length);

  if (all.length === 0) {
    el.gallery.appendChild(node("div", "empty", "Nenhuma evidência fotográfica nos itens coletados."));
    return;
  }

  for (const entry of all) {
    const card = node("div", "shot");
    if (entry.attachment.src) {
      const img = document.createElement("img");
      img.src = entry.attachment.src;
      img.alt = entry.attachment.name || "evidência";
      img.loading = "lazy";
      card.appendChild(img);
    }
    const cap = node("div", "cap");
    cap.appendChild(node("span", "nm", entry.attachment.name || "(sem nome)"));
    const chip = node(
      "span",
      "chip " + (entry.attachment.status || "unknown"),
      entry.attachment.statusLabel || entry.attachment.status
    );
    cap.appendChild(chip);
    cap.appendChild(node("div", null, "#" + entry.item.index + " " + entry.item.name));
    card.appendChild(cap);
    el.gallery.appendChild(card);
  }
}

function renderItems(items) {
  el.itemsBody.textContent = "";
  el.itemsCount.textContent = String((items || []).length);

  for (const item of items || []) {
    const row = document.createElement("tr");

    row.appendChild(node("td", null, item.sectionCode || item.sectionLabel || "—"));
    const nameCell = node("td", null, item.name);
    row.appendChild(nameCell);
    row.appendChild(node("td", null, item.requirementLabel));

    const statusCell = document.createElement("td");
    statusCell.appendChild(node("span", "chip " + item.status, item.statusLabel || item.status));
    row.appendChild(statusCell);

    row.appendChild(node("td", null, item.radio && item.radio.answer ? item.radio.answer : "—"));

    const filled = item.inputs.filter((input) => input.value);
    row.appendChild(
      node(
        "td",
        null,
        filled.length ? filled.map((input) => (input.label ? input.label + ": " : "") + input.value).join(" | ") : "—"
      )
    );

    row.appendChild(node("td", "num", String(item.attachments.length)));

    const issuesCell = node("td", "num", item.issues.length ? String(item.issues.length) : "—");
    if (item.issues.length) {
      issuesCell.title = item.issues.map((issue) => issue.message).join("\n");
      issuesCell.style.color = item.issues.some((issue) => issue.severity === "error") ? "#f87171" : "#fbbf24";
      issuesCell.style.fontWeight = "700";
    }
    row.appendChild(issuesCell);

    el.itemsBody.appendChild(row);
  }
}

function renderNotes(notes) {
  el.notes.textContent = "";
  for (const note of notes || []) el.notes.appendChild(node("li", null, note));
}

async function start() {
  el.btnRefresh.addEventListener("click", reanalyze);
  el.btnEmptyRefresh.addEventListener("click", reanalyze);
  el.btnPrint.addEventListener("click", () => window.print());

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!changes[STORAGE_KEY]) return;
      const data = changes[STORAGE_KEY].newValue;
      if (data) render(data);
    });
  }

  const stored = await readStored();
  if (stored) render(stored);
  else {
    el.content.classList.add("hidden");
    el.empty.classList.remove("hidden");
  }
}

start();
