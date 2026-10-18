// Popup script — requests the DOM analysis from the active tab and renders it.
const NDPD_HOST_PATTERN = /(^|\.)deliveryplatform\.nokia\.com$/i;

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const resultEl = document.getElementById("result");
const workorderEl = document.getElementById("workorder");
const kpisEl = document.getElementById("kpis");
const issuesEl = document.getElementById("issues");
const sectionsEl = document.getElementById("sections");
const itemsEl = document.getElementById("items");
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

  // Fallback: the user may have the extension popup open while another window is focused.
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

function sendAnalyze(tabId, type) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type }, (response) => {
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
  return (
    "Não foi possível ler a página do NDPd (" +
    message +
    "). Recarregue a aba (F5) e clique em Analisar."
  );
}

async function analyze(mode) {
  const type = mode === "active" ? "NDPD_ANALYZE" : "NDPD_ANALYZE_ALL";
  setLoading(true, mode === "active" ? "Analisando a seção ativa…" : "Coletando todas as seções…");
  collecting = true;

  try {
    const tab = await getActiveTab();
    if (tab.id == null) throw new Error("Não foi possível identificar a aba ativa.");
    const host = tabHost(tab);

    if (host && !NDPD_HOST_PATTERN.test(host)) {
      throw new Error(
        "A aba ativa não é do NDPd (" + host + "). Abra a tela de execução do checklist."
      );
    }

    let data;
    try {
      data = await sendAnalyze(tab.id, type);
    } catch (firstError) {
      if (firstError.analysis) throw firstError;

      try {
        await injectAnalyzer(tab.id);
        data = await sendAnalyze(tab.id, type);
      } catch (secondError) {
        throw new Error(friendlyError(tab, secondError));
      }
    }

    currentResult = data;
    render(data);
    setLoading(false, "Análise atualizada às " + new Date().toLocaleTimeString("pt-BR"));
  } catch (error) {
    currentResult = null;
    renderError(error.message || String(error));
    setLoading(false, "Falha na análise");
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

  renderWorkOrder(data);
  renderKpis(data.summary);
  renderIssues(data.issues);
  renderSections(data);
  renderItems(data.items);
  renderNotes(data.notes);
}

function renderWorkOrder(data) {
  workorderEl.textContent = "";
  const order = data.workOrder || {};
  const titleParts = [];
  if (order.number) titleParts.push(order.number);
  if (order.name) titleParts.push(order.name);
  const title = titleParts.length
    ? titleParts.join(" · ")
    : order.header || "Checklist sem identificação";

  workorderEl.appendChild(el("div", "wo-title", title));

  const meta = [];
  if (order.header && order.header !== title) meta.push(order.header);
  if (order.smpId) meta.push("SMP: " + order.smpId);
  if (data.summary) {
    meta.push(
      "Seções coletadas: " + data.summary.sectionsCollected + "/" + data.summary.sections
    );
  }
  meta.push(data.mode === "active" ? "modo: seção ativa" : "modo: coleta completa");
  workorderEl.appendChild(el("div", "wo-meta", meta.join("  •  ")));
}

function kpi(label, value, tone) {
  const box = el("div", "kpi" + (tone ? " " + tone : ""));
  box.appendChild(el("span", "num", String(value)));
  box.appendChild(el("span", "lbl", label));
  return box;
}

function renderKpis(summary) {
  kpisEl.textContent = "";
  kpisEl.appendChild(kpi("Itens", summary.items));
  kpisEl.appendChild(kpi("Aceitos", summary.accepted, "ok"));
  kpisEl.appendChild(kpi("Rejeitados", summary.rejected, summary.rejected ? "err" : ""));
  kpisEl.appendChild(kpi("Pendentes", summary.pending, summary.pending ? "warn" : ""));
  kpisEl.appendChild(kpi("Anexos", summary.attachments));
  kpisEl.appendChild(
    kpi("Problemas", summary.issues, summary.errors ? "err" : summary.warnings ? "warn" : "ok")
  );
}

function renderIssues(issues) {
  issuesEl.textContent = "";
  if (!issues || issues.length === 0) {
    issuesEl.appendChild(el("div", "empty", "Nenhum problema encontrado nas validações automáticas."));
    return;
  }

  const order = { error: 0, warning: 1, info: 2 };
  const sorted = issues.slice().sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  for (const issue of sorted) {
    const row = el("div", "issue " + issue.severity);
    row.appendChild(
      el(
        "span",
        "tag",
        issue.severity === "error" ? "Erro" : issue.severity === "warning" ? "Alerta" : "Info"
      )
    );

    const body = el("div", null);
    body.appendChild(el("span", null, issue.message));
    const where = [];
    if (issue.section) where.push(issue.section);
    if (issue.itemName) where.push("#" + issue.itemIndex + " " + issue.itemName);
    if (where.length) body.appendChild(el("span", "where", where.join("  •  ")));
    row.appendChild(body);

    issuesEl.appendChild(row);
  }
}

function renderSections(data) {
  sectionsEl.textContent = "";
  if (!data.sections || data.sections.length === 0) {
    sectionsEl.appendChild(el("div", "empty", "Nenhuma seção encontrada."));
    return;
  }

  for (const section of data.sections) {
    const row = el("div", "section-row" + (section.active ? " active" : ""));
    const top = el("div", "section-top");
    top.appendChild(
      el("span", "section-name", (section.code ? section.code + " " : "") + section.name)
    );
    top.appendChild(el("span", "section-badge", section.badge || "—"));
    row.appendChild(top);

    if (section.counts) {
      const total = section.counts.total || 0;
      const accepted = section.counts.accepted || 0;
      const percent = total > 0 ? Math.round((accepted / total) * 100) : 0;

      const bar = el("div", "bar");
      const fill = el("span");
      fill.style.width = percent + "%";
      if (percent < 100) fill.style.background = "#fbbf24";
      bar.appendChild(fill);
      row.appendChild(bar);

      row.appendChild(el("div", "section-note", "DOM: " + accepted + "/" + total + " aceitos (" + percent + "%)"));
    } else {
      row.appendChild(
        el("div", "section-note", "Não coletada (menu lateral apenas com contagem).")
      );
    }

    sectionsEl.appendChild(row);
  }
}

function detail(key, value) {
  const box = el("div", "kv");
  box.appendChild(el("span", "k", key));
  box.appendChild(el("span", "v", value));
  return box;
}

function renderItems(items) {
  itemsEl.textContent = "";
  if (!items || items.length === 0) {
    itemsEl.appendChild(el("div", "empty", "Nenhum caso de teste encontrado."));
    return;
  }

  for (const item of items) {
    const details = el("details", "item");

    const summary = el("summary");
    summary.appendChild(el("span", "dot " + item.status));

    const main = el("div", "item-main");
    main.appendChild(el("span", "item-name", "#" + item.index + "  " + item.name));

    const sub = el("div", "item-sub");
    if (item.sectionCode) sub.appendChild(el("span", "pill", item.sectionCode));
    sub.appendChild(el("span", "pill", item.statusLabel || item.status));
    sub.appendChild(
      el("span", "pill " + (item.requirement === "required" ? "req" : "opt"), item.requirementLabel)
    );
    if (item.radio && item.radio.answer) {
      sub.appendChild(el("span", "pill", "Resposta: " + item.radio.answer));
    }
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
          "Campos preenchidos",
          filledInputs.map((input) => (input.label ? input.label + " = " : "") + input.value).join("  •  ")
        )
      );
    }

    if (item.attachments.length) {
      body.appendChild(el("span", "k", "Evidências"));
      const thumbs = el("div", "thumbs");
      for (const attachment of item.attachments) {
        if (attachment.src) {
          const img = el("img", "thumb");
          img.src = attachment.src;
          img.alt = attachment.name || "anexo";
          img.title = (attachment.name || "anexo") + " — " + attachment.statusLabel;
          thumbs.appendChild(img);
        }
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
    itemsEl.appendChild(details);
  }
}

function renderNotes(notes) {
  notesEl.textContent = "";
  for (const note of notes || []) {
    notesEl.appendChild(el("li", null, note));
  }
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
