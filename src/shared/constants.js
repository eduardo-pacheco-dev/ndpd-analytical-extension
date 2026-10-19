// Shared constants: status vocabulary, labels and selectors used by analyzer + popup.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.shared = ndpd.shared || {};
  ndpd.shared.constants = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // Order matters: a node can carry more than one state class, the first match wins.
  const STATUS_SELECTOR = [
    ".accepted-state",
    ".rejected-state",
    ".pending-state",
    ".performed-state",
    ".accepted-state-ground",
    ".rejected-state-ground",
    ".accepted-state-ai",
    ".rejected-state-ai",
  ].join(",");

  const STATUS_MAP = {
    "accepted-state": "accepted",
    "accepted-state-ground": "accepted",
    "accepted-state-ai": "accepted",
    "rejected-state": "rejected",
    "rejected-state-ground": "rejected",
    "rejected-state-ai": "rejected",
    "pending-state": "pending",
    "performed-state": "performed",
    "submitted-state": "awaiting",
    "resubmitted-state": "awaiting",
    "submit-state": "awaiting",
    "resubmit-state": "awaiting",
    "awaiting-state": "awaiting",
    "awaiting-evaluation-state": "awaiting",
    "under-review-state": "awaiting",
    "evaluation-state": "awaiting",
  };

  const STATUS_LABEL = {
    accepted: "Aceito",
    rejected: "Rejeitado",
    pending: "Pendente",
    performed: "Executado",
    awaiting: "Aguardando avaliação",
    unknown: "Sem status",
  };

  // "Submitted"/"Resubmitted" (etc.) mean the item is waiting for evaluation.
  const AWAITING_RE = /resubmit|submit|aguard|avali|waiting|under.?review|em an[áa]lise/i;

  const REQUIREMENT_LABEL = {
    required: "Obrigatório",
    optional: "Opcional",
    unknown: "Não informado",
  };

  const FIELD_TYPE_LABEL = {
    text: "Texto",
    textarea: "Texto longo",
    select: "Seleção",
    radio: "Escolha única",
    checkbox: "Caixa de seleção",
    toggle: "Interruptor",
    date: "Data",
  };

  return {
    STATUS_SELECTOR,
    STATUS_MAP,
    STATUS_LABEL,
    AWAITING_RE,
    REQUIREMENT_LABEL,
    FIELD_TYPE_LABEL,
  };
});
