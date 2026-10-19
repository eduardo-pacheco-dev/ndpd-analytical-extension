"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { clean, cleanLabel, parseBadge } = require("../../src/shared/text.js");

test("clean normalizes whitespace, nbsp and null values", () => {
  assert.equal(clean("  a\u00a0 b \n c "), "a b c");
  assert.equal(clean(null), "");
  assert.equal(clean(undefined), "");
  assert.equal(clean(42), "42");
});

test("cleanLabel removes required/obrigatório markers and asterisks", () => {
  assert.equal(cleanLabel("Nome *Required"), "Nome");
  assert.equal(cleanLabel("Nome obrigatório"), "Nome");
  assert.equal(cleanLabel("Nome *"), "Nome");
  assert.equal(cleanLabel("Nome Obrigatorio"), "Nome");
});

test("parseBadge extracts accepted/total from a badge text", () => {
  assert.deepEqual(parseBadge(" 9 / 10 "), { accepted: 9, total: 10, raw: "9 / 10" });
  assert.deepEqual(parseBadge("sem número"), { accepted: null, total: null, raw: "sem número" });
  assert.deepEqual(parseBadge(null), { accepted: null, total: null, raw: "" });
});
