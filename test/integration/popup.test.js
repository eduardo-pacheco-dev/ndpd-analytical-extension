"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const scripts = require("../../src/shared/scripts.js");

const ROOT = path.resolve(__dirname, "..", "..");

// Boots popup.html + every popup script inside jsdom with a stub chrome API.
function bootPopup() {
  const html = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    tabs: { query: () => {}, sendMessage: () => {} },
    scripting: { executeScript: () => {} },
  };

  for (const file of scripts.POPUP_SCRIPTS) {
    dom.window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
  }

  return dom.window;
}

const checklistResult = {
  kind: "checklist",
  workOrder: { number: "WO-1", smpId: "SMP-9" },
  summary: { items: 1, required: 1, sections: 1, sectionsCollected: 1 },
  sections: [
    { code: "1", name: "Segurança", label: "1 Segurança", badge: "1/1", badgeAccepted: 1, badgeTotal: 1, counts: { accepted: 1, total: 1 } },
  ],
  steps: [],
  fields: [],
  items: [
    {
      index: 1,
      name: "Verificar fusível",
      status: "accepted",
      statusLabel: "Aceito",
      requirement: "required",
      requirementLabel: "Obrigatório",
      sectionCode: "1",
      sectionLabel: "1 Segurança",
      radio: null,
      inputs: [{ label: "Obs", value: "ok" }],
      attachments: [],
      issues: [],
    },
  ],
  issues: [{ severity: "error", code: "item-rejected", message: "Item rejeitado.", section: "1 Segurança", itemIndex: 1, itemName: "Verificar fusível" }],
  notes: ["nota 1", "nota 2"],
};

test("popup scripts boot and expose the popup namespace", () => {
  const window = bootPopup();
  assert.ok(window.NdPd.popup.format);
  assert.ok(window.NdPd.popup.client);
  assert.ok(window.NdPd.popup.ui);
});

test("the dashboard renders a checklist report into the popup markup", () => {
  const window = bootPopup();
  const dashboard = window.NdPd.popup.ui.createDashboard(window.document);
  dashboard.render(checklistResult);

  const document = window.document;
  assert.equal(document.getElementById("result").classList.contains("hidden"), false);
  assert.equal(document.getElementById("kpis").children.length, 4);
  assert.equal(document.getElementById("items-count").textContent, "1");
  assert.equal(document.getElementById("issues-count").textContent, "1");
  assert.match(document.getElementById("workorder").textContent, /WO-1/);
  assert.equal(document.getElementById("notes").children.length, 2);
});

test("the dashboard renders errors and export filenames come from the format module", () => {
  const window = bootPopup();
  const dashboard = window.NdPd.popup.ui.createDashboard(window.document);
  dashboard.renderError("falhou");

  assert.equal(window.document.getElementById("error").classList.contains("hidden"), false);
  const exported = window.NdPd.popup.format.buildCsvExport(checklistResult, new Date("2024-02-03T04:05:06Z"));
  assert.match(exported.filename, /^ndpd-analise_WO-1_SMP-9_/);
});
