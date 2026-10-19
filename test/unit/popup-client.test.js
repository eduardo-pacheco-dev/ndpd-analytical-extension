"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const client = require("../../src/popup/client.js");
const scripts = require("../../src/shared/scripts.js");

function makeChrome(handlers) {
  const runtime = { lastError: null };
  return {
    runtime,
    tabs: {
      query: (query, callback) => {
        runtime.lastError = null;
        handlers.query(query, callback, runtime);
      },
      sendMessage: (tabId, message, callback) => {
        runtime.lastError = null;
        handlers.sendMessage(tabId, message, callback, runtime);
      },
    },
    scripting: {
      executeScript: (options, callback) => {
        runtime.lastError = null;
        handlers.executeScript(options, callback, runtime);
      },
    },
  };
}

test("tabHost extracts the hostname or null", () => {
  assert.equal(client.tabHost({ url: "https://a.deliveryplatform.nokia.com/x" }), "a.deliveryplatform.nokia.com");
  assert.equal(client.tabHost({ url: "not a url" }), null);
  assert.equal(client.tabHost(null), null);
});

test("friendlyError explains each failure family", () => {
  assert.match(client.friendlyError({ url: "https://example.com" }, new Error("x")), /não é do NDPd/);
  assert.match(
    client.friendlyError({ url: "https://a.deliveryplatform.nokia.com" }, new Error("Cannot access contents")),
    /Sem permissão/
  );
  assert.match(
    client.friendlyError({ url: "https://a.deliveryplatform.nokia.com" }, new Error("message port closed")),
    /Recarregue a aba/
  );
  assert.match(client.friendlyError({ url: "https://a.deliveryplatform.nokia.com" }, new Error("boom")), /boom/);
});

test("getActiveTab returns the active NDPd tab", async () => {
  const chrome = makeChrome({
    query: (_query, callback) => callback([{ id: 1, url: "https://a.deliveryplatform.nokia.com/x", windowId: 1 }]),
  });
  const { getActiveTab } = client.createAnalysisClient(chrome);
  const tab = await getActiveTab();
  assert.equal(tab.id, 1);
});

test("getActiveTab falls back to an NDPd tab in the same window", async () => {
  const chrome = makeChrome({
    query: (query, callback) => {
      if (query.url) return callback([{ id: 2, url: "https://b.deliveryplatform.nokia.com", windowId: 1 }, { id: 3, url: "https://c.deliveryplatform.nokia.com", windowId: 2 }]);
      return callback([{ id: 1, url: "https://example.com", windowId: 1 }]);
    },
  });
  const { getActiveTab } = client.createAnalysisClient(chrome);
  const tab = await getActiveTab();
  assert.equal(tab.id, 2);
});

test("getActiveTab throws when no tab is available", async () => {
  const chrome = makeChrome({ query: (_query, callback) => callback([]) });
  const { getActiveTab } = client.createAnalysisClient(chrome);
  await assert.rejects(() => getActiveTab(), /Nenhuma aba ativa/);
});

test("sendAnalyze resolves with the response data", async () => {
  const chrome = makeChrome({
    sendMessage: (_tabId, _message, callback) => callback({ ok: true, data: { kind: "checklist" } }),
  });
  const { sendAnalyze } = client.createAnalysisClient(chrome);
  assert.deepEqual(await sendAnalyze(1, "NDPD_ANALYZE", 1000), { kind: "checklist" });
});

test("sendAnalyze marks analysis failures and rejects runtime errors", async () => {
  const failureChrome = makeChrome({
    sendMessage: (_tabId, _message, callback) => callback({ ok: false, error: "Página não reconhecida." }),
  });
  const { sendAnalyze } = client.createAnalysisClient(failureChrome);
  await assert.rejects(() => sendAnalyze(1, "NDPD_ANALYZE", 1000), (error) => {
    assert.equal(error.analysis, true);
    assert.match(error.message, /não reconhecida/);
    return true;
  });

  const errorChrome = makeChrome({
    sendMessage: (_tabId, _message, callback, runtime) => {
      runtime.lastError = { message: "Receiving end does not exist" };
      callback(undefined);
    },
  });
  const errorClient = client.createAnalysisClient(errorChrome);
  await assert.rejects(() => errorClient.sendAnalyze(1, "NDPD_ANALYZE", 1000), /Receiving end does not exist/);
});

test("sendAnalyze rejects when the page does not answer", async () => {
  const chrome = makeChrome({ sendMessage: (_tabId, _message, callback) => callback(undefined) });
  const { sendAnalyze } = client.createAnalysisClient(chrome);
  await assert.rejects(() => sendAnalyze(1, "NDPD_ANALYZE", 1000), /não respondeu/);
});

test("injectAnalyzer injects the whole content script chain", async () => {
  let received;
  const chrome = makeChrome({ executeScript: (options, callback) => { received = options; callback(); } });
  const { injectAnalyzer } = client.createAnalysisClient(chrome);
  await injectAnalyzer(7);
  assert.equal(received.target.tabId, 7);
  assert.deepEqual(received.files, scripts.CONTENT_SCRIPTS);
});
