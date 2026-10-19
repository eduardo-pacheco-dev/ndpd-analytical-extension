"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scripts = require("../../src/shared/scripts.js");
const { checklistPage } = require("../helpers/fixtures.js");

const ROOT = path.resolve(__dirname, "..", "..");

// Boots the full content-script chain (analyzer + collector + bridge + content.js) inside jsdom.
function bootContentScripts(html) {
  const dom = new JSDOM(html, {
    url: "https://x.deliveryplatform.nokia.com/e?workOrderNumber=WO-1",
    runScripts: "outside-only",
  });
  const listeners = [];
  const noop = () => {};
  dom.window.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop };
  dom.window.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
      sendMessage: () => {},
    },
  };

  for (const file of scripts.CONTENT_SCRIPTS) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    dom.window.eval(source);
  }

  return { dom, window: dom.window, listeners };
}

test("the content-script chain registers a single message listener and analyzer API", () => {
  const { window, listeners } = bootContentScripts(checklistPage());

  assert.equal(listeners.length, 1);
  assert.ok(window.NdPdAnalyzer);
  assert.ok(window.NdPdScraper);
  assert.equal(window.__ndpdAnalytical.version, 8);
});

test("a second injection of content.js does not duplicate the listener", () => {
  const { window, listeners } = bootContentScripts(checklistPage());
  window.eval(fs.readFileSync(path.join(ROOT, "content.js"), "utf8"));
  assert.equal(listeners.length, 1);
});

test("NDPD_ANALYZE responds with the active checklist analysis", () => {
  const { window, listeners } = bootContentScripts(checklistPage());
  let response;

  const result = listeners[0]({ type: "NDPD_ANALYZE" }, null, (value) => {
    response = value;
  });

  assert.equal(result, undefined);
  assert.equal(response.ok, true);
  assert.equal(response.data.kind, "checklist");
  assert.equal(response.data.summary.items, 3);
});

test("diagnostics exposes the detected navigator levels", () => {
  const { window } = bootContentScripts(checklistPage());
  const info = window.__ndpdDiagnostics();
  assert.equal(info.level0.kind, "checklist");
  assert.equal(info.level0.items.length, 2);
  assert.equal(info.candidates.sidebarItems, 2);
});
