"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const checklist = require("../../src/analyzer/checklist.js");

function itemDom(inner) {
  return makeDom(`<div class="content-item">${inner}</div>`);
}

function parse(inner, section) {
  const { document } = itemDom(inner);
  return checklist.parseItem(document.querySelector(".content-item"), 1, section);
}

test("parseItem reads status, requirement, radio and inputs", () => {
  const item = parse(
    `<div><h4 class="testcase-name-overflow">Verificar fusível</h4>` +
      `<span class="accepted-state">Aceito</span><span>*Required</span></div>` +
      `<mat-radio-group>` +
      `<mat-radio-button class="mat-radio-checked"><input type="radio" value="Sim" checked /><span>Sim</span></mat-radio-button>` +
      `<mat-radio-button><input type="radio" value="Não" /><span>Não</span></mat-radio-button>` +
      `</mat-radio-group>` +
      `<input class="mat-input-element" placeholder="Observação" value="ok" />`,
    { code: "1", label: "1 Segurança" }
  );

  assert.equal(item.status, "accepted");
  assert.equal(item.statusLabel, "Aceito");
  assert.equal(item.requirement, "required");
  assert.equal(item.requirementLabel, "Obrigatório");
  assert.equal(item.sectionCode, "1");
  assert.deepEqual(item.radio, { options: ["Sim", "Não"], answer: "Sim", disabled: false });
  assert.deepEqual(item.inputs, [{ label: "Observação", value: "ok", disabled: false, readonly: false }]);
  assert.deepEqual(item.issues, []);
});

test("rejected items raise an error issue", () => {
  const item = parse(
    `<div><h4>Item</h4><span class="rejected-state">Rejeitado</span></div>`
  );
  assert.equal(item.status, "rejected");
  assert.deepEqual(item.issues.map((issue) => issue.code), ["item-rejected"]);
  assert.equal(item.issues[0].severity, "error");
});

test("pending optional items raise a warning, required ones an error", () => {
  const optional = parse(`<div><h4>Item</h4><span class="pending-state"></span></div>`);
  assert.equal(optional.issues.find((issue) => issue.code === "item-pending").severity, "warning");

  const required = parse(`<div><h4>Item</h4><span class="pending-state"></span> <span>Optional</span></div>`);
  assert.equal(required.requirement, "optional");

  const requiredItem = parse(`<div><h4>Item</h4><span>*Required</span></div>`);
  assert.equal(requiredItem.status, "pending");
  assert.equal(requiredItem.issues.find((issue) => issue.code === "item-pending").severity, "error");
});

test("unanswered radio raises a validation issue", () => {
  const item = parse(
    `<div><h4>Pergunta</h4><span class="accepted-state"></span><span>*Required</span></div>` +
      `<mat-radio-group><mat-radio-button><input type="radio" value="Sim" /></mat-radio-button></mat-radio-group>`
  );
  const issue = item.issues.find((entry) => entry.code === "radio-unanswered");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("empty required input is reported with its label", () => {
  const item = parse(
    `<div><h4>Campo</h4><span class="accepted-state"></span><span>*Required</span></div>` +
      `<input class="mat-input-element" placeholder="Serial" value="" />`
  );
  const issue = item.issues.find((entry) => entry.code === "input-required-empty");
  assert.ok(issue);
  assert.match(issue.message, /Serial/);
});

test("photo item without attachment warns about missing evidence", () => {
  const item = parse(`<div><h4>Foto do painel</h4><span class="accepted-state"></span></div>`);
  assert.ok(item.issues.some((entry) => entry.code === "attachment-missing"));
});

test("attachments are scoped to their own evidence block", () => {
  const item = parse(
    `<div><h4>Foto</h4><span class="accepted-state"></span></div>` +
      `<div class="evidence">` +
      `<div class="imgBx"><img src="https://files/1.png" /></div>` +
      `<textarea class="text-area-for-image-name">painel.png</textarea>` +
      `<span class="rejected-state">Rejeitado</span>` +
      `</div>`
  );

  assert.equal(item.attachments.length, 1);
  assert.deepEqual(item.attachments[0], {
    name: "painel.png",
    src: "https://files/1.png",
    status: "rejected",
    statusLabel: "Rejeitado",
    issues: [{ severity: "error", code: "attachment-rejected", message: "Anexo rejeitado: painel.png." }],
  });
  assert.ok(item.issues.some((entry) => entry.code === "attachment-rejected"));
});

test("unnamed attachments are flagged", () => {
  const item = parse(
    `<div><h4>Foto</h4><span class="accepted-state"></span></div>` +
      `<div class="evidence"><div class="imgBx"><img src="x" /></div>` +
      `<textarea class="text-area-for-image-name"></textarea></div>`
  );
  assert.ok(item.issues.some((entry) => entry.code === "attachment-unnamed"));
});

test("readWorkOrder reads URL params and the header", () => {
  const { document, location } = makeDom(
    `<app-execution-view><span class="rex-font-header-3">Cabeçalho</span></app-execution-view>`,
    "https://x.deliveryplatform.nokia.com/e?workOrderNumber=WO-9&smpId=SMP-1&name=Servico&executeFrom=web&isMigrated=true"
  );
  assert.deepEqual(checklist.readWorkOrder(document, location), {
    header: "Cabeçalho",
    smpId: "SMP-1",
    number: "WO-9",
    name: "Servico",
    executeFrom: "web",
    isMigrated: "true",
  });
});
