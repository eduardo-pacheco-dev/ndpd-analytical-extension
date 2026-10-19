"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const { checklistPage, formStepsPage } = require("../helpers/fixtures.js");
const analyzer = require("../../src/analyzer/analyzer.js");

const NOW = () => new Date("2024-02-03T04:05:06Z");

test("analyzeDocument produces a checklist report for a checklist page", () => {
  const { document, location } = makeDom(checklistPage());
  const result = analyzer.analyzeDocument(document, location, NOW);

  assert.equal(result.kind, "checklist");
  assert.equal(result.summary.items, 3);
  assert.equal(result.summary.accepted, 1);
  assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.pending, 1);
  assert.equal(result.summary.sections, 2);
  assert.equal(result.workOrder.number, "WO-1");
  assert.equal(result.items[0].name, "Verificar fusível");
  assert.equal(result.items[0].statusLabel, "Aceito");
});

test("analyzeDocument produces a form report for a stepper page", () => {
  const { document, location } = makeDom(formStepsPage());
  const result = analyzer.analyzeDocument(document, location, NOW);

  assert.equal(result.kind, "form-steps");
  assert.equal(result.summary.steps, 1);
  assert.equal(result.summary.stepsCollected, 1);
  assert.equal(result.summary.fields, 3);
  assert.equal(result.summary.filled, 1);
  assert.equal(result.summary.requiredEmpty, 1);
  assert.ok(result.issues.some((issue) => issue.code === "required-field-empty"));
});

test("analyzeDocument rejects pages that do not look like NDPd execution", () => {
  const { document, location } = makeDom("<html><body><div>oi</div></body></html>");
  assert.throws(() => analyzer.analyzeDocument(document, location, NOW), /não reconhecida/);
});

test("analyzeDocument rejects a checklist page without the execution marker", () => {
  const { document, location } = makeDom(
    "<app-checklist-side-sections><div class=\"sidebar-item\"></div></app-checklist-side-sections>"
  );
  assert.throws(() => analyzer.analyzeDocument(document, location, NOW), /não reconhecida/);
});

test("activeContentScope and captureLeaf read the active step fields", () => {
  const { document } = makeDom(formStepsPage());
  const scope = analyzer.activeContentScope(document);
  assert.ok(scope);
  assert.equal(analyzer.readFields(scope).length, 3);

  const captured = analyzer.captureLeaf(document, { code: "1", label: "1 Dados" });
  assert.equal(captured.fields.length, 3);
  assert.equal(captured.items.length, 0);
});

test("captureLeaf reads checklist items when present", () => {
  const { document } = makeDom(checklistPage());
  const captured = analyzer.captureLeaf(document, { code: "1", label: "1 Segurança" });
  assert.equal(captured.items.length, 3);
  assert.equal(captured.attachments.length, 1);
});
