"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scripts = require("../../src/shared/scripts.js");

const ROOT = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");

test("manifest is a valid MV3 extension scoped to the NDPd host", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.deepEqual(manifest.host_permissions, ["https://*.deliveryplatform.nokia.com/*"]);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.content_scripts[0].matches[0], "https://*.deliveryplatform.nokia.com/*");
});

test("manifest content scripts match the shared CONTENT_SCRIPTS order", () => {
  assert.deepEqual(manifest.content_scripts[0].js, scripts.CONTENT_SCRIPTS);
});

test("every content script and popup script exists on disk", () => {
  const referenced = scripts.CONTENT_SCRIPTS.concat(scripts.POPUP_SCRIPTS, ["popup.html", "manifest.json"]);
  for (const file of referenced) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), "arquivo ausente: " + file);
  }
});

test("popup.html loads the popup scripts in dependency order", () => {
  let cursor = -1;
  for (const file of scripts.POPUP_SCRIPTS) {
    const position = popupHtml.indexOf(`src="${file}"`);
    assert.ok(position > cursor, `script fora de ordem ou ausente: ${file}`);
    cursor = position;
  }
  assert.ok(!/popup\.js" type="module"/.test(popupHtml), "popup.js deve ser um script clássico");
});

test("dependency modules are ordered before their consumers", () => {
  const order = scripts.CONTENT_SCRIPTS;
  const indexOf = (file) => order.indexOf(file);
  assert.ok(indexOf("src/shared/text.js") < indexOf("src/analyzer/analyzer.js"));
  assert.ok(indexOf("src/analyzer/status.js") < indexOf("src/analyzer/checklist.js"));
  assert.ok(indexOf("src/analyzer/checklist.js") < indexOf("src/analyzer/report.js"));
  assert.ok(indexOf("src/analyzer/scopes.js") < indexOf("src/analyzer/analyzer.js"));
  assert.equal(order[order.length - 1], "content.js");
});

test("obsolete root analyzer bundle is gone", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "analyzer.js")), false);
});
