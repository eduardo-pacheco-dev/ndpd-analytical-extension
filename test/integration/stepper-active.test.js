"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const analyzer = require("../../src/analyzer/analyzer.js");
const { createCollector } = require("../../src/content/collector.js");

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms) => {
      time += ms;
      return Promise.resolve();
    },
  };
}

// Emulates the real NDPd/Material stepper: EVERY step label carries
// `.mat-step-label-active`, only the selected one adds `.mat-step-label-selected` +
// aria-selected="true"; inactive panels stay in the DOM as
// `.mat-horizontal-stepper-content-inactive` with inline `visibility: hidden`.
function materialStepperDom() {
  const names = ["Alpha", "Beta", "Gamma"];

  const header = (index) =>
    `<mat-step-header role="tab" id="h${index}" aria-selected="${index === 0}"` +
    ` class="mat-step-header mat-primary mat-horizontal-stepper-header">` +
    `<div class="mat-step-text-label"><div>Etapa ${index + 1}</div></div>` +
    `<div class="mat-step-label mat-step-label-active${index === 0 ? " mat-step-label-selected" : ""}"></div>` +
    `</mat-step-header>`;

  const panel = (index) =>
    `<div role="tabpanel" id="p${index}" aria-labelledby="h${index}"` +
    ` class="mat-horizontal-stepper-content${index === 0 ? "" : " mat-horizontal-stepper-content-inactive"}"` +
    ` style="transform: translate3d(${index === 0 ? 0 : 100}%, 0px, 0px); visibility: ${index === 0 ? "inherit" : "hidden"};">` +
    `<div class="content-body">` +
    `<div class="content-item">` +
    `<div><h4 class="testcase-name-overflow">Item ${names[index]}</h4><span class="accepted-state">Aceito</span></div>` +
    `<input class="mat-input-element" placeholder="Valor" value="${names[index]}" />` +
    `</div>` +
    `</div>` +
    `</div>`;

  const html =
    `<!doctype html><html><head><title>Execução</title></head><body>` +
    `<app-execution-view><span class="rex-font-header-3">WO header</span></app-execution-view>` +
    `<mat-horizontal-stepper role="tablist" class="mat-stepper-horizontal">` +
    names.map((_, index) => header(index)).join("") +
    `<div class="mat-horizontal-stepper-wrapper">` +
    names.map((_, index) => panel(index)).join("") +
    `</div>` +
    `</mat-horizontal-stepper>` +
    `</body></html>`;

  const dom = makeDom(html);
  const headers = names.map((_, index) => dom.document.getElementById("h" + index));
  const panels = names.map((_, index) => dom.document.getElementById("p" + index));

  headers.forEach((headerEl, index) => {
    headerEl.addEventListener("click", () => {
      headers.forEach((node, position) => {
        node.setAttribute("aria-selected", String(position === index));
        node.querySelector(".mat-step-label").classList.toggle("mat-step-label-selected", position === index);
      });
      panels.forEach((node, position) => {
        node.classList.toggle("mat-horizontal-stepper-content-inactive", position !== index);
        node.style.visibility = position === index ? "inherit" : "hidden";
      });
    });
  });

  return { ...dom, headers, panels };
}

test("only the selected stepper label counts as active (mat-step-label-active is shared)", () => {
  const { document, headers } = materialStepperDom();

  assert.equal(analyzer.hasActiveMarker(headers[0]), true, "first step should be active");
  assert.equal(analyzer.hasActiveMarker(headers[1]), false, "inactive step must not be active");
  assert.equal(analyzer.hasActiveMarker(headers[2]), false, "inactive step must not be active");

  // Every header contains `.mat-step-label-active`; a naive check would mark all as active.
  assert.equal(document.querySelectorAll(".mat-step-label-active").length, 3);
  assert.equal(document.querySelectorAll(".mat-step-label-selected").length, 1);
});

test("activeContentScope and isVisible ignore hidden inactive panels", () => {
  const { document, panels } = materialStepperDom();
  assert.equal(analyzer.isVisible(panels[0]), true);
  assert.equal(analyzer.isVisible(panels[1]), false);

  const scope = analyzer.activeContentScope(document);
  assert.equal(scope.id, "p0");
});

test("collectAll walks every stepper step and collects each step's own data", async () => {
  const { window, document, location } = materialStepperDom();
  const progress = [];
  const collector = createCollector({ analyzer, window, document, location, clock: fakeClock() });

  const report = await collector.collectAll((update) => progress.push(update));

  const names = report.items.map((item) => item.name).sort();
  assert.deepEqual(names, ["Item Alpha", "Item Beta", "Item Gamma"]);
  assert.equal(report.summary.items, 3);
  assert.equal(report.summary.sections, 3);
  assert.equal(report.summary.sectionsCollected, 3);

  // Each item keeps the value that belongs to its own step.
  const byName = Object.fromEntries(report.items.map((item) => [item.name, item.inputs[0].value]));
  assert.deepEqual(byName, { "Item Alpha": "Alpha", "Item Beta": "Beta", "Item Gamma": "Gamma" });

  assert.equal(progress[progress.length - 1].done, true);
});

test("analyzeDocument reports the active step of the stepper as a checklist", () => {
  const { document, location } = materialStepperDom();
  const result = analyzer.analyzeDocument(document, location);

  assert.equal(result.kind, "checklist");
  assert.equal(result.summary.items, 1);
  assert.equal(result.items[0].name, "Item Alpha");
});
