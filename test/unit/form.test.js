"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const form = require("../../src/analyzer/form.js");

function scopeDom(inner) {
  const dom = makeDom(`<div id="scope">${inner}</div>`);
  return dom.document.getElementById("scope");
}

test("readFields reads text, textarea and date inputs", () => {
  const scope = scopeDom(
    `<mat-form-field><mat-label>SMP ID</mat-label><input class="mat-input-element" required value="123" /></mat-form-field>` +
      `<mat-form-field><mat-label>Comentário</mat-label><textarea class="mat-input-element"></textarea></mat-form-field>` +
      `<mat-form-field><mat-label>Data</mat-label><input class="mat-input-element" type="date" value="2024-01-01" /></mat-form-field>`
  );
  const fields = form.readFields(scope);
  assert.equal(fields.length, 3);

  assert.deepEqual(fields[0], {
    type: "text",
    typeLabel: "Texto",
    label: "SMP ID",
    value: "123",
    filled: true,
    required: true,
    disabled: false,
    readonly: false,
  });
  assert.equal(fields[1].type, "textarea");
  assert.equal(fields[1].filled, false);
  assert.equal(fields[2].type, "date");
});

test("readFields reads mat-select with placeholder awareness", () => {
  const scope = scopeDom(
    `<mat-form-field><mat-label>Ambiente</mat-label><mat-select aria-required="true">` +
      `<div class="mat-select-value-text"></div><div class="mat-select-placeholder">Escolha</div></mat-select></mat-form-field>`
  );
  const [field] = form.readFields(scope);
  assert.equal(field.type, "select");
  assert.equal(field.label, "Ambiente");
  assert.equal(field.filled, false);
  assert.equal(field.required, true);
});

test("readFields reads radio groups and checkbox/toggle states", () => {
  const scope = scopeDom(
    `<mat-radio-group><mat-radio-button class="mat-radio-checked"><input type="radio" value="A" checked />A</mat-radio-button>` +
      `<mat-radio-button><input type="radio" value="B" />B</mat-radio-button></mat-radio-group>` +
      `<mat-checkbox class="mat-checkbox-checked"><input type="checkbox" checked /></mat-checkbox>` +
      `<mat-slide-toggle class="mat-checked"></mat-slide-toggle>`
  );
  const fields = form.readFields(scope);
  const radio = fields.find((field) => field.type === "radio");
  const checkbox = fields.find((field) => field.type === "checkbox");
  const toggle = fields.find((field) => field.type === "toggle");

  assert.equal(radio.value, "A");
  assert.equal(radio.filled, true);
  assert.deepEqual(radio.options, ["A", "B"]);
  assert.equal(checkbox.value, "Sim");
  assert.equal(toggle.value, "Ligado");
});

test("readFields skips hidden fields", () => {
  const scope = scopeDom(
    `<mat-form-field aria-hidden="true"><mat-label>Oculto</mat-label><input class="mat-input-element" value="x" /></mat-form-field>` +
      `<mat-form-field style="display:none"><mat-label>Nenhum</mat-label><input class="mat-input-element" /></mat-form-field>` +
      `<mat-form-field><mat-label>Visível</mat-label><input class="mat-input-element" value="y" /></mat-form-field>`
  );
  const fields = form.readFields(scope);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].label, "Visível");
});

test("fieldLabel falls back to placeholder, aria-label and nearby heading", () => {
  const { document } = makeDom(
    `<div id="scope">` +
      `<input id="byPlaceholder" class="mat-input-element" placeholder="Apenas placeholder" />` +
      `<input id="byAria" class="mat-input-element" aria-label="Rótulo ARIA" />` +
      `<h3>Seção relevante</h3><mat-form-field><input id="byHeading" class="mat-input-element" /></mat-form-field>` +
      `</div>`
  );
  assert.equal(form.fieldLabel(document.getElementById("byPlaceholder"), "text"), "Apenas placeholder");
  assert.equal(form.fieldLabel(document.getElementById("byAria"), "text"), "Rótulo ARIA");
  assert.equal(form.fieldLabel(document.getElementById("byHeading"), "text"), "Seção relevante");
});

test("readFields returns [] for a missing scope", () => {
  assert.deepEqual(form.readFields(null), []);
});
