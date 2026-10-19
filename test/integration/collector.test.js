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
    elapsed: () => time,
  };
}

function stepperDom() {
  const html =
    `<mat-stepper-horizontal>` +
    `<div class="mat-stepper-horizontal">` +
    [0, 1, 2]
      .map(
        (index) =>
          `<mat-step-header id="h${index}" aria-selected="${index === 0}">` +
          `<div class="mat-step-text-label">Passo ${index + 1}</div></mat-step-header>`
      )
      .join("") +
    `</div>` +
    `<div id="content"><div class="mat-step-content">` +
    `<mat-form-field><mat-label>Campo 1</mat-label><input class="mat-input-element" value="1" /></mat-form-field>` +
    `</div></div>` +
    `</mat-stepper-horizontal>`;

  const dom = makeDom(html);
  const headers = [0, 1, 2].map((index) => dom.document.getElementById("h" + index));
  const content = dom.document.getElementById("content");

  const activate = (index) => {
    headers.forEach((header, position) => header.setAttribute("aria-selected", String(position === index)));
    content.innerHTML =
      `<div class="mat-step-content"><mat-form-field><mat-label>Campo ${index + 1}</mat-label>` +
      `<input class="mat-input-element" value="${index + 1}" /></mat-form-field></div>`;
  };
  headers.forEach((header, index) => header.addEventListener("click", () => activate(index)));

  return { ...dom, headers, activate };
}

test("collectAll walks every step, scrapes fields and restores the initial step", async () => {
  const { window, document, location } = stepperDom();
  const clock = fakeClock();
  const progress = [];

  const collector = createCollector({
    analyzer,
    window,
    document,
    location,
    clock,
  });

  const report = await collector.collectAll((update) => progress.push(update));

  assert.equal(report.kind, "form-steps");
  assert.equal(report.summary.steps, 3);
  assert.equal(report.summary.stepsCollected, 3);
  assert.equal(report.summary.fields, 3);
  assert.equal(report.summary.filled, 3);
  assert.deepEqual(report.steps.map((step) => step.label), ["1. Passo 1", "2. Passo 2", "3. Passo 3"]);
  assert.deepEqual(report.fields.map((field) => field.value), ["1", "2", "3"]);

  assert.equal(progress[progress.length - 1].done, true);
  assert.ok(progress.some((update) => update.current === 2 && update.total === 3));

  // The step that was open before the collection is restored.
  assert.equal(collector.activeIndex(document, "steps"), 0);
});

test("activate reports node-not-found for an invalid index", async () => {
  const { window, document, location } = stepperDom();
  const collector = createCollector({ analyzer, window, document, location, clock: fakeClock() });
  assert.deepEqual(await collector.activate(document, "steps", 99), { ok: false, reason: "node-not-found" });
});

test("contentSignature changes when the active step content changes", () => {
  const { window, document, location, activate } = stepperDom();
  const collector = createCollector({ analyzer, window, document, location, clock: fakeClock() });
  const before = collector.contentSignature(document);
  activate(1);
  assert.notEqual(collector.contentSignature(document), before);
});
