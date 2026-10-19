// Popup controller: orchestrates tab analysis, dashboard rendering and exports.
(function () {
  "use strict";

  const format = NdPd.popup.format;
  const clientModule = NdPd.popup.client;
  const client = clientModule.createAnalysisClient(chrome);
  const dashboard = NdPd.popup.ui.createDashboard(document);
  const els = dashboard.elements;

  let currentResult = null;
  let collecting = false;

  function setLoading(isLoading, message) {
    dashboard.setLoading(isLoading, message, Boolean(currentResult));
  }

  async function analyze(mode) {
    const type = mode === "active" ? "NDPD_ANALYZE" : "NDPD_ANALYZE_ALL";
    const timeout = type === "NDPD_ANALYZE_ALL" ? 180000 : 30000;
    setLoading(true, mode === "active" ? "Analisando a seção ativa…" : "Coletando todas as seções…");
    collecting = true;
    if (els.idle) els.idle.classList.add("hidden");
    dashboard.showProgress(
      mode === "active" ? "Lendo a seção ativa…" : "Conectando à aba do NDPd…",
      null,
      { indeterminate: true }
    );

    try {
      const tab = await client.getActiveTab();
      if (tab.id == null) throw new Error("Não foi possível identificar a aba ativa.");
      const host = clientModule.tabHost(tab);
      console.info("[NDPd Analytical] analisando aba", tab.id, host || "(host indisponível)", type);

      if (host && !clientModule.NDPD_HOST_PATTERN.test(host)) {
        throw new Error(
          "A aba ativa não é do NDPd (" + host + "). Abra a tela de execução do checklist."
        );
      }

      let data;
      try {
        data = await client.sendAnalyze(tab.id, type, timeout);
      } catch (firstError) {
        if (firstError.analysis) throw firstError;
        console.info("[NDPd Analytical] primeira tentativa falhou, injetando content script:", firstError.message);

        try {
          await client.injectAnalyzer(tab.id);
          data = await client.sendAnalyze(tab.id, type, timeout);
        } catch (secondError) {
          throw new Error(clientModule.friendlyError(tab, secondError));
        }
      }

      currentResult = data;
      dashboard.render(data);
      dashboard.showProgress("Coleta concluída", 100, { done: true });
      setLoading(false, "Análise atualizada às " + new Date().toLocaleTimeString("pt-BR"));
      console.info("[NDPd Analytical] relatório pronto:", JSON.stringify(data.summary));
    } catch (error) {
      currentResult = null;
      dashboard.renderError(error.message || String(error));
      dashboard.hideProgress();
      setLoading(false, "Falha na análise");
      console.warn("[NDPd Analytical] falha:", error.message || String(error));
    } finally {
      collecting = false;
    }
  }

  function exportCsv() {
    const exported = format.buildCsvExport(currentResult);
    if (!exported) return;
    dashboard.downloadFile(exported.filename, exported.content, exported.mime);
  }

  function exportJson() {
    const exported = format.buildJsonExport(currentResult);
    if (!exported) return;
    dashboard.downloadFile(exported.filename, exported.content, exported.mime);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "NDPD_PROGRESS" || !collecting) return;
    const progress = message.progress || {};
    if (progress.done) {
      els.status.textContent = "Montando relatório…";
      dashboard.showProgress("Montando relatório…", 100, { done: true });
      return;
    }
    const percent = format.overallPercent(progress.trail);
    const depthLabel = progress.depth ? "nível " + (progress.depth + 1) + " · " : "";
    els.status.textContent =
      "Coletando (" + progress.current + "/" + progress.total + "): " + (progress.label || "");
    dashboard.showProgress(depthLabel + (progress.label || ""), percent);
  });

  els.refreshBtn.addEventListener("click", () => analyze("all"));
  els.allBtn.addEventListener("click", () => analyze("all"));
  els.activeBtn.addEventListener("click", () => analyze("active"));
  els.jsonBtn.addEventListener("click", exportJson);
  els.csvBtn.addEventListener("click", exportCsv);
})();
