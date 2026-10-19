// Analyzer facade: composes the domain modules into a single public API.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("../shared/constants.js"),
      require("./status.js"),
      require("./dom.js"),
      require("./navigation.js"),
      require("./attachments.js"),
      require("./checklist.js"),
      require("./form.js"),
      require("./report.js"),
      require("./scopes.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  const analyzer = factory(
    ndpd.shared.text,
    ndpd.shared.constants,
    ndpd.analyzer.status,
    ndpd.analyzer.dom,
    ndpd.analyzer.navigation,
    ndpd.analyzer.attachments,
    ndpd.analyzer.checklist,
    ndpd.analyzer.form,
    ndpd.analyzer.report,
    ndpd.analyzer.scopes
  );
  ndpd.analyzer.api = analyzer;
  root.NdPdAnalyzer = analyzer;
})(typeof globalThis === "object" ? globalThis : this, function (
  text,
  constants,
  status,
  dom,
  navigation,
  attachments,
  checklist,
  form,
  report,
  scopes
) {
  "use strict";

  const { readFields } = form;
  const { activeContentScope, captureCurrent } = scopes;
  const { buildFormReport, buildReport } = report;

  const NOT_RECOGNIZED =
    "Página não reconhecida como execução do NDPd. Abra a tela de execução de um checklist ou formulário.";

  // Builds a report for a form that has no navigator but has a single rendered scope.
  function buildSingleScopeForm(doc, location, scope, now) {
    const ref = { index: 0, label: "Formulário", name: "Formulário" };
    return buildFormReport(
      doc,
      location,
      [
        {
          index: 0,
          ref,
          fields: readFields(scope),
          attachments: scopes.captureLeaf(doc, ref).attachments,
          rendered: true,
        },
      ],
      "active",
      "form",
      now
    );
  }

  function analyzeDocument(doc, location, now) {
    const navigator = navigation.planNavigator(doc);

    if (navigator.kind === "checklist" && !doc.querySelector("app-checklist-execution-special")) {
      throw new Error(NOT_RECOGNIZED);
    }

    if (navigator.items.length === 0) {
      const scope = activeContentScope(doc);
      if (readFields(scope).length === 0) throw new Error(NOT_RECOGNIZED);
      return buildSingleScopeForm(doc, location, scope, now);
    }

    const activeIndex = navigator.items.findIndex((item) => item.active);
    const active = activeIndex >= 0 ? navigator.items[activeIndex] : navigator.items[0];
    const captured = captureCurrent(doc, navigator.kind, active);

    return buildReport(
      doc,
      location,
      [{ index: active ? active.index : 0, ref: active, ...captured, rendered: true }],
      "active",
      navigator.kind,
      now
    );
  }

  return {
    analyzeDocument,
    buildReport,
    planNavigator: navigation.planNavigator,
    captureCurrent,
    captureLeaf: scopes.captureLeaf,
    activeContentScope,
    contentScopes: scopes.contentScopes,
    visibleContentScopes: scopes.visibleContentScopes,
    detectNavigator: navigation.detectNavigator,
    navigatorOf: navigation.navigatorOf,
    navNodes: navigation.navNodes,
    nodeActive: navigation.nodeActive,
    hasActiveMarker: navigation.hasActiveMarker,
    readSections: navigation.readSections,
    readSteps: navigation.readSteps,
    readTabs: navigation.readTabs,
    readItems: checklist.readItems,
    readFields: form.readFields,
    readFieldsFromScopes: form.readFieldsFromScopes,
    readAttachments: attachments.readAttachments,
    readAttachmentsFromScopes: attachments.readAttachmentsFromScopes,
    readWorkOrder: checklist.readWorkOrder,
    isVisible: dom.isVisible,
    isHidden: dom.isHidden,
    clean: text.clean,
    STATUS_LABEL: constants.STATUS_LABEL,
    REQUIREMENT_LABEL: constants.REQUIREMENT_LABEL,
    FIELD_TYPE_LABEL: constants.FIELD_TYPE_LABEL,
  };
});
