"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createMessageHandler } = require("../../src/content/bridge.js");

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("NDPD_ANALYZE_ALL streams progress and responds with the report", async () => {
  const progress = [];
  let response;
  const handler = createMessageHandler({
    collector: {
      collectAll: (onProgress) => {
        onProgress({ current: 1, total: 2, label: "1 Passo" });
        return Promise.resolve({ kind: "form-steps", summary: {} });
      },
    },
    analyzeActive: () => ({}),
    notifyProgress: (update) => progress.push(update),
  });

  const keepAlive = handler({ type: "NDPD_ANALYZE_ALL" }, null, (value) => { response = value; });
  assert.equal(keepAlive, true);
  await flush();

  assert.deepEqual(progress, [{ current: 1, total: 2, label: "1 Passo" }]);
  assert.deepEqual(response, { ok: true, data: { kind: "form-steps", summary: {} } });
});

test("NDPD_ANALYZE_ALL reports collection failures", async () => {
  let response;
  const handler = createMessageHandler({
    collector: { collectAll: () => Promise.reject(new Error("falhou")) },
    analyzeActive: () => ({}),
  });

  handler({ type: "NDPD_ANALYZE_ALL" }, null, (value) => { response = value; });
  await flush();
  assert.deepEqual(response, { ok: false, error: "falhou" });
});

test("NDPD_ANALYZE_ALL fails fast when the analyzer is missing", () => {
  let called = false;
  let response;
  const handler = createMessageHandler({
    collector: { collectAll: () => { called = true; return Promise.resolve({}); } },
    analyzeActive: () => ({}),
    hasAnalyzer: () => false,
  });

  const result = handler({ type: "NDPD_ANALYZE_ALL" }, null, (value) => { response = value; });
  assert.equal(result, undefined);
  assert.equal(called, false);
  assert.deepEqual(response, { ok: false, error: "Analisador não carregado nesta página." });
});

test("NDPD_ANALYZE responds synchronously with the active analysis", () => {
  let response;
  const handler = createMessageHandler({
    collector: { collectAll: () => Promise.resolve({}) },
    analyzeActive: () => ({ kind: "checklist", summary: { items: 2 } }),
  });

  const result = handler({ type: "NDPD_ANALYZE" }, null, (value) => { response = value; });
  assert.equal(result, undefined);
  assert.deepEqual(response, { ok: true, data: { kind: "checklist", summary: { items: 2 } } });
});

test("NDPD_ANALYZE reports analyzer errors", () => {
  let response;
  const handler = createMessageHandler({
    collector: { collectAll: () => Promise.resolve({}) },
    analyzeActive: () => { throw new Error("Página não reconhecida."); },
  });

  handler({ type: "NDPD_ANALYZE" }, null, (value) => { response = value; });
  assert.deepEqual(response, { ok: false, error: "Página não reconhecida." });
});

test("unknown messages are ignored", () => {
  const handler = createMessageHandler({ collector: {}, analyzeActive: () => ({}) });
  assert.equal(handler(null, null, () => {}), undefined);
  assert.equal(handler({ type: "OTHER" }, null, () => {}), undefined);
});
