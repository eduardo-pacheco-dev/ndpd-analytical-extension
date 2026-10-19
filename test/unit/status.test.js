"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const { readStatus, resolveStatus, firstStatusIn } = require("../../src/analyzer/status.js");

test("readStatus maps known classes and falls back to unknown", () => {
  const { document } = makeDom(`<div id="a" class="accepted-state-ai"></div><div id="b"></div>`);
  assert.equal(readStatus(document.getElementById("a")), "accepted");
  assert.equal(readStatus(document.getElementById("b")), "unknown");
  assert.equal(readStatus(null), "unknown");
});

test("readStatus prefers the first matching class of the status map", () => {
  const { document } = makeDom(`<div class="rejected-state-ground performed-state"></div>`);
  assert.equal(readStatus(document.querySelector("div")), "rejected");
});

test("resolveStatus uses class, then text, then header, then defaults to pending", () => {
  const { document } = makeDom(
    `<div id="byClass" class="rejected-state-x"><span class="rejected-state"></span></div>` +
      `<div id="byText" class="mystery">Aguardando avaliação</div>` +
      `<div id="plain" class="mystery">nada</div>`
  );

  assert.equal(resolveStatus(document.querySelector("#byClass .rejected-state"), ""), "rejected");
  assert.equal(resolveStatus(document.getElementById("byText"), ""), "awaiting");
  assert.equal(resolveStatus(document.getElementById("plain"), "Item submitted"), "awaiting");
  assert.equal(resolveStatus(document.getElementById("plain"), "qualquer"), "pending");
  assert.equal(resolveStatus(null, ""), "pending");
});

test("firstStatusIn finds the first descendant matching the status selector", () => {
  const { document } = makeDom(
    `<div id="root"><span class="x"></span><span class="pending-state"></span><span class="accepted-state"></span></div>`
  );
  const found = firstStatusIn(document.getElementById("root"));
  assert.ok(found);
  assert.equal(found.className, "pending-state");
  assert.equal(firstStatusIn(null), null);
});
