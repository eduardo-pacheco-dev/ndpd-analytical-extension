"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeDom } = require("../helpers/dom.js");
const nav = require("../../src/analyzer/navigation.js");

test("navNodes deduplicates and ignores overlay/menu entries", () => {
  const { document } = makeDom(
    `<app-checklist-side-sections>` +
      `<div class="sidebar-item"><span class="sidebar-item"></span></div>` +
      `</app-checklist-side-sections>` +
      `<div class="cdk-overlay-pane"><mat-step-header></mat-step-header></div>`
  );
  const nodes = nav.navNodes(document, "checklist");
  assert.equal(nodes.length, 1);
  assert.equal(nav.navNodes(document, "steps").length, 0);
});

test("hasActiveMarker detects every documented marker", () => {
  const { document } = makeDom(
    `<div id="class" class="tab active-tab"></div>` +
      `<div id="selected" aria-selected="true"></div>` +
      `<div id="current" aria-current="step"></div>` +
      `<div id="expanded" aria-expanded="true"></div>` +
      `<div id="child"><span class="mat-step-label-active"></span></div>` +
      `<div id="none"></div>`
  );
  assert.equal(nav.hasActiveMarker(document.getElementById("class")), true);
  assert.equal(nav.hasActiveMarker(document.getElementById("selected")), true);
  assert.equal(nav.hasActiveMarker(document.getElementById("current")), true);
  assert.equal(nav.hasActiveMarker(document.getElementById("expanded")), true);
  assert.equal(nav.hasActiveMarker(document.getElementById("child")), true);
  assert.equal(nav.hasActiveMarker(document.getElementById("none")), false);
  assert.equal(nav.hasActiveMarker(null), false);
  assert.equal(nav.nodeActive("steps", document.getElementById("selected")), true);
});

test("itemFromSection parses code, name, badge and label", () => {
  const { document } = makeDom(
    `<div class="sidebar-item active"><span class="bold-label">3</span><span class="label">3 FCC &amp; Baterias</span><span class="badge">2/5</span></div>`
  );
  const item = nav.itemFromSection(document.querySelector(".sidebar-item"), 0);
  assert.deepEqual(item, {
    index: 0,
    code: "3",
    name: "FCC & Baterias",
    label: "3 FCC & Baterias",
    badge: "2/5",
    badgeAccepted: 2,
    badgeTotal: 5,
    active: true,
    counts: null,
    rendered: false,
  });
});

test("itemFromStep and itemFromTab use sensible fallbacks", () => {
  const { document } = makeDom(
    `<mat-step-header><div class="mat-step-text-label">Dados *Required</div></mat-step-header>` +
      `<div class="mat-tab-label"></div>`
  );
  const step = nav.itemFromStep(document.querySelector("mat-step-header"), 0);
  assert.equal(step.label, "1. Dados");
  assert.equal(step.name, "Dados");
  assert.equal(step.kind, "step");

  const tab = nav.itemFromTab(document.querySelector(".mat-tab-label"), 1);
  assert.equal(tab.label, "Aba 2");
  assert.equal(tab.kind, "tab");
});

test("navigatorOf honours the used set", () => {
  const { document } = makeDom(
    `<mat-step-header id="a"></mat-step-header><mat-step-header id="b"></mat-step-header>`
  );
  const first = nav.navigatorOf(document, "steps");
  const used = new Set([first.nodes[0]]);
  const second = nav.navigatorOf(document, "steps", used);
  assert.equal(second.nodes.length, 1);
  assert.equal(second.nodes[0].id, "b");
});

test("detectNavigator picks the outermost navigator by DOM position", () => {
  const { document } = makeDom(
    `<mat-stepper-horizontal>` +
      `<mat-step-header></mat-step-header>` +
      `<app-checklist-side-sections><div class="sidebar-item"></div></app-checklist-side-sections>` +
      `</mat-stepper-horizontal>`
  );
  const detected = nav.detectNavigator(document, new Set());
  assert.equal(detected.kind, "steps");
  assert.equal(detected.items.length, 1);
});

test("planNavigator falls back to form with no items", () => {
  const { document } = makeDom(`<div></div>`);
  assert.deepEqual(nav.planNavigator(document), { kind: "form", items: [] });
});
