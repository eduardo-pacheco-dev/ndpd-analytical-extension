"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const format = require("../../src/popup/format.js");

test("overallPercent estimates nested progress and caps at 99", () => {
  assert.equal(format.overallPercent([]), 0);
  assert.equal(format.overallPercent(null), 0);
  assert.equal(format.overallPercent([{ current: 2, total: 4, sub: 0 }]), 25);
  assert.equal(format.overallPercent([{ current: 1, total: 2, sub: 0.5 }]), 25);
  assert.equal(
    format.overallPercent([
      { current: 1, total: 2, sub: 0 },
      { current: 1, total: 2, sub: 0 },
    ]),
    0
  );
  assert.equal(format.overallPercent([{ current: 100, total: 100, sub: 0 }]), 99);
});

test("csvCell escapes separators, quotes and newlines", () => {
  assert.equal(format.csvCell("simples"), "simples");
  assert.equal(format.csvCell("a;b"), '"a;b"');
  assert.equal(format.csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(format.csvCell("linha\noutra"), "linha outra");
  assert.equal(format.csvCell(null), "");
});

const checklistResult = {
  kind: "checklist",
  workOrder: { number: "WO-1", smpId: "SMP-9" },
  items: [
    {
      index: 1,
      name: "Verificar fusível",
      sectionCode: "1",
      sectionLabel: "1 Segurança",
      requirementLabel: "Obrigatório",
      status: "rejected",
      statusLabel: "Rejeitado",
      radio: { answer: "Sim", options: ["Sim", "Não"], disabled: false },
      attachments: [
        { name: "foto.png", status: "rejected", statusLabel: "Rejeitado" },
        { name: "", status: "accepted", statusLabel: "Aceito" },
      ],
      inputs: [{ label: "Obs", value: "ok" }],
      issues: [{ message: "Item rejeitado." }],
    },
  ],
};

test("buildChecklistCsvRows flattens items into semicolon-separated rows", () => {
  const rows = format.buildChecklistCsvRows(checklistResult);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [
    "Secao",
    "Item",
    "Obrigatoriedade",
    "Status",
    "Resposta",
    "Anexos",
    "Anexos rejeitados",
    "Anexos sem nome",
    "Campos",
    "Problemas",
  ]);
  assert.equal(rows[1][1], "#1 Verificar fusível");
  assert.equal(rows[1][4], "Sim");
  assert.equal(rows[1][5], "foto.png [Rejeitado] | (sem nome) [Aceito]");
  assert.equal(rows[1][6], 1);
  assert.equal(rows[1][7], 1);
  assert.equal(rows[1][8], "Obs=ok");
});

test("buildFormCsvRows includes related issues", () => {
  const result = {
    kind: "form-steps",
    fields: [{ stepLabel: "1 Dados", label: "SMP ID", type: "text", required: true, filled: false, value: "" }],
    issues: [{ itemName: "1 Dados", message: "Campo obrigatório vazio: SMP ID." }],
  };
  const rows = format.buildFormCsvRows(result);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], "1 Dados");
  assert.equal(rows[1][3], "Sim");
  assert.equal(rows[1][4], "Nao");
  assert.equal(rows[1][6], "Campo obrigatório vazio: SMP ID.");
});

test("buildCsvExport and buildJsonExport build filenames from the work order", () => {
  const date = new Date("2024-02-03T04:05:06.000Z");
  const csv = format.buildCsvExport(checklistResult, date);
  assert.equal(csv.filename, "ndpd-analise_WO-1_SMP-9_2024-02-03T04-05-06-000Z.csv");
  assert.equal(csv.mime, "text/csv;charset=utf-8");
  assert.ok(csv.content.startsWith("\uFEFF"));

  const json = format.buildJsonExport(checklistResult, date);
  assert.equal(json.mime, "application/json");
  assert.match(json.content, /"kind": "checklist"/);
  assert.equal(format.buildCsvExport(null, date), null);
});
