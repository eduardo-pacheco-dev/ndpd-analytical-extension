// Chrome-facing client for the popup: tab resolution, messaging and injection.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../shared/scripts.js"));
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.popup = ndpd.popup || {};
  ndpd.popup.client = factory(ndpd.shared.scripts);
})(typeof globalThis === "object" ? globalThis : this, function (scripts) {
  "use strict";

  const NDPD_HOST_PATTERN = /(^|\.)deliveryplatform\.nokia\.com$/i;

  function tabHost(tab) {
    if (!tab || !tab.url) return null;
    try {
      return new URL(tab.url).hostname;
    } catch (error) {
      return null;
    }
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

  function createAnalysisClient(chrome) {
    function queryTabs(query) {
      return new Promise((resolve, reject) => {
        chrome.tabs.query(query, (tabs) => {
          const error = chrome.runtime.lastError;
          if (error) return reject(new Error(error.message));
          resolve(tabs || []);
        });
      });
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
          { target: { tabId }, files: scripts.CONTENT_SCRIPTS },
          () => {
            const error = chrome.runtime.lastError;
            if (error) return reject(new Error(error.message));
            resolve();
          }
        );
      });
    }

    return { queryTabs, getActiveTab, sendAnalyze, injectAnalyzer };
  }

  return { NDPD_HOST_PATTERN, tabHost, friendlyError, createAnalysisClient };
});
