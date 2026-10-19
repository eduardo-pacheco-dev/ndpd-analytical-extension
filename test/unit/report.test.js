"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const report = require("../../src/analyzer/report.js");

const NOW = () => new Date("2024-02-03T04:05:06Z");
const ISO = "2024-02-03T04:05:06.000Z";

function base() {
  const { document, location } = makeDom(`<html><head><title>Página</title></head><body></body></html>`);
  return { document, location };
}

function checklistItem(index, patch) {
  return {
    index,
    name: "Item " + index,
    requirement: "optional",
    status: "accepted",
    sectionCode: "1",
    sectionLabel: "1 Segurança",
    attachments: [],
    issues: [],
    ...patch,
  };
}

test("buildChecklistReport aggregates sections, items and summary counts", () => {
  const { document, location } = base();
  const collected = [
    {
      index: 0,
      rendered: true,
      ref: {
        index: 0,
        code: "1",
        label: "1 Segurança",
        name: "Segurança",
        badge: "1/2",
        badgeAccepted: 1,
        badgeTotal: 2,
        active: true,
      },
      items: [
        checklistItem(1, { status: "accepted", requirement: "required" }),
        checklistItem(2, { status: "rejected", issues: [{ severity: "error", code: "item-rejected", message: "Item rejeitado." }] }),
      ],
    },
  ];

  const result = report.buildChecklistReport(document, location, collected, "all", NOW);

  assert.equal(result.generatedAt, ISO);
  assert.equal(result.kind, "checklist");
  assert.equal(result.summary.sections, 1);
  assert.equal(result.summary.sectionsCollected, 1);
  assert.equal(result.summary.items, 2);
  assert.equal(result.summary.accepted, 1);
  assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.required, 1);
  assert.equal(result.summary.optional, 1);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.items[0].sectionLabel, "1 Segurança");
  assert.ok(result.notes[0].startsWith("Coleta completa: 1/1"));
});

test("buildChecklistReport flags badge divergence and not-loaded sections", () => {
  const { document, location } = base();
  const collected = [
    {
      index: 0,
      rendered: true,
      ref: { index: 0, code: "1", label: "Seção A", badge: "9/10", badgeAccepted: 9, badgeTotal: 10 },
      items: [checklistItem(1)],
    },
    {
      index: 1,
      rendered: false,
      ref: { index: 1, code: "2", label: "Seção B" },
      items: [],
    },
  ];

  const result = report.buildChecklistReport(document, location, collected, "all", NOW);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes("badge-mismatch-accepted"));
  assert.ok(codes.includes("badge-mismatch-total"));
  assert.ok(codes.includes("section-not-loaded"));
});

test("buildChecklistReport detects duplicated attachment names", () => {
  const { document, location } = base();
  const attachment = { name: "foto.png", src: "", status: "accepted", statusLabel: "", issues: [] };
  const collected = [
    {
      index: 0,
      rendered: true,
      ref: { index: 0, code: "1", label: "Seção A" },
      items: [checklistItem(1, { attachments: [attachment] }), checklistItem(2, { attachments: [attachment] })],
    },
  ];

  const result = report.buildChecklistReport(document, location, collected, "all", NOW);
  const duplicate = result.issues.find((issue) => issue.code === "attachment-duplicate");
  assert.ok(duplicate);
  assert.match(duplicate.message, /foto\.png/);
});

test("buildChecklistReport warns when no items were found", () => {
  const { document, location } = base();
  const result = report.buildChecklistReport(document, location, [], "all", NOW);
  assert.ok(result.issues.some((issue) => issue.code === "no-items"));
  assert.equal(result.summary.items, 0);
});

test("buildChecklistReport lists every sidebar section in active mode", () => {
  const { document, location } = makeDom(
    `<app-checklist-side-sections>` +
      `<div class="sidebar-item"><span class="bold-label">1</span><span class="label">1 A</span></div>` +
      `<div class="sidebar-item active"><span class="bold-label">2</span><span class="label">2 B</span></div>` +
      `</app-checklist-side-sections>`
  );
  const collected = [
    {
      index: 1,
      rendered: true,
      ref: { index: 1, code: "2", label: "2 B", active: true },
      items: [checklistItem(1)],
    },
  ];

  const result = report.buildChecklistReport(document, location, collected, "active", NOW);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[1].rendered, true);
  assert.equal(result.sections[1].counts.total, 1);
  assert.equal(result.sections[0].rendered, false);
});

function formField(patch) {
  return { type: "text", label: "Campo", value: "", filled: false, required: false, disabled: false, readonly: false, ...patch };
}

test("buildFormReport aggregates fields and raises validation issues", () => {
  const { document, location } = base();
  const collected = [
    {
      index: 0,
      rendered: true,
      ref: { index: 0, code: "1", label: "1 Dados" },
      fields: [
        formField({ type: "text", label: "SMP ID", required: true, value: "", filled: false }),
        formField({ type: "select", label: "Ambiente", value: "", filled: false }),
        formField({ type: "text", label: "Comentário", value: "ok", filled: true }),
      ],
      attachments: [],
    },
    { index: 1, rendered: false, ref: { index: 1, code: "2", label: "2 Revisão" }, fields: [], attachments: [] },
  ];

  const result = report.buildFormReport(document, location, collected, "all", "steps", NOW);

  assert.equal(result.kind, "form-steps");
  assert.equal(result.summary.steps, 2);
  assert.equal(result.summary.stepsCollected, 1);
  assert.equal(result.summary.fields, 3);
  assert.equal(result.summary.filled, 1);
  assert.equal(result.summary.requiredEmpty, 1);
  assert.equal(result.fields[0].stepIndex, 1);
  assert.equal(result.fields[2].stepLabel, "1 Dados");
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.warnings, 2);
  assert.ok(result.issues.some((issue) => issue.code === "required-field-empty"));
  assert.ok(result.issues.some((issue) => issue.code === "select-empty"));
  assert.ok(result.issues.some((issue) => issue.code === "step-not-loaded"));
});

test("buildFormReport flags rejected and unnamed attachments", () => {
  const { document, location } = base();
  const collected = [
    {
      index: 0,
      rendered: true,
      ref: { index: 0, code: "1", label: "1 Fotos" },
      fields: [formField({ filled: true, value: "x" })],
      attachments: [
        { name: "", status: "rejected", statusLabel: "", issues: [] },
      ],
    },
  ];
  const result = report.buildFormReport(document, location, collected, "all", "steps", NOW);
  assert.ok(result.issues.some((issue) => issue.code === "attachment-rejected"));
  assert.ok(result.issues.some((issue) => issue.code === "attachment-unnamed"));
});

test("buildFormReport emits no-fields when a step has no fields", () => {
  const { document, location } = base();
  const result = report.buildFormReport(
    document,
    location,
    [{ index: 0, rendered: true, ref: { index: 0, code: "1", label: "1 Vazio" }, fields: [], attachments: [] }],
    "all",
    "steps",
    NOW
  );
  assert.ok(result.issues.some((issue) => issue.code === "no-fields"));
});

test("buildReport chooses checklist, form or the kind fallback", () => {
  const { document, location } = base();
  const itemEntry = [{ index: 0, rendered: true, ref: { index: 0, label: "S" }, items: [checklistItem(1)], fields: [] }];
  const fieldEntry = [{ index: 0, rendered: true, ref: { index: 0, label: "S" }, fields: [formField({ filled: true, value: "x" })], items: [] }];
  const mixedEntry = [
    { index: 0, rendered: true, ref: { index: 0, label: "S" }, items: [checklistItem(1)], fields: [formField({ filled: true, value: "x" })] },
  ];
  const emptyEntry = [{ index: 0, rendered: true, ref: { index: 0, label: "S" }, items: [], fields: [] }];

  assert.equal(report.buildReport(document, location, itemEntry, "all", "checklist", NOW).kind, "checklist");
  assert.equal(report.buildReport(document, location, fieldEntry, "all", "steps", NOW).kind, "form-steps");
  assert.equal(report.buildReport(document, location, mixedEntry, "all", "steps", NOW).kind, "form-steps");
  assert.equal(report.buildReport(document, location, emptyEntry, "all", "checklist", NOW).kind, "checklist");
  assert.equal(report.buildReport(document, location, emptyEntry, "all", "form", NOW).kind, "form-steps");
});
