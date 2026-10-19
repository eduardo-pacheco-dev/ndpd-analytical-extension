"use strict";

const { JSDOM } = require("jsdom");

const DEFAULT_URL = "https://example.deliveryplatform.nokia.com/execution?workOrderNumber=WO-1&smpId=SMP-9&name=Servico";

// Builds an isolated DOM (jsdom) for analyzer/collector tests.
function makeDom(html, url) {
  const dom = new JSDOM(html || "<!doctype html><html><body></body></html>", {
    url: url || DEFAULT_URL,
    pretendToBeVisual: true,
  });
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
  };
}

module.exports = { makeDom, DEFAULT_URL };
