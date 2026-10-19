"use strict";

// Realistic NDPd-like markup used by unit and integration tests.

function checklistItem({ name, statusClass, statusText, requirement, radio, inputValue, attachment }) {
  const radioHtml = radio
    ? `<mat-radio-group>${radio.options
        .map(
          (option, index) =>
            `<mat-radio-button class="${radio.answer === option ? "mat-radio-checked" : ""}">` +
            `<input type="radio" value="${option}" ${radio.answer === option ? "checked" : ""} />` +
            `<span>${option}</span></mat-radio-button>`
        )
        .join("")}</mat-radio-group>`
    : "";
  const inputHtml =
    inputValue == null
      ? ""
      : `<input class="mat-input-element" placeholder="Observação" value="${inputValue}" />`;
  const attachmentHtml = attachment
    ? `<div class="imgBx"><img src="${attachment.src}" /></div>` +
      `<textarea class="text-area-for-image-name">${attachment.name}</textarea>` +
      (attachment.statusClass
        ? `<span class="${attachment.statusClass}">${attachment.statusText || ""}</span>`
        : "")
    : "";

  return (
    `<div class="content-item">` +
    `<div>` +
    `<h4 class="testcase-name-overflow">${name}</h4>` +
    `<span class="${statusClass || "pending-state"}">${statusText || ""}</span>` +
    (requirement === "required" ? `<span>*Required</span>` : "") +
    `</div>` +
    radioHtml +
    inputHtml +
    attachmentHtml +
    `</div>`
  );
}

function checklistPage() {
  return (
    `<!doctype html><html><head><title>Execução</title></head><body>` +
    `<app-checklist-execution-special>` +
    `<app-checklist-side-sections>` +
    `<div class="sidebar-item active"><span class="bold-label">1</span><span class="label">1 Segurança</span><span class="badge">1/2</span></div>` +
    `<div class="sidebar-item"><span class="bold-label">2</span><span class="label">2 Rede</span><span class="badge">0/1</span></div>` +
    `</app-checklist-side-sections>` +
    `<div class="checklist"><div class="content-body">` +
    checklistItem({
      name: "Verificar fusível",
      statusClass: "accepted-state",
      statusText: "Aceito",
      requirement: "required",
      radio: { options: ["Sim", "Não"], answer: "Sim" },
      inputValue: "ok",
    }) +
    checklistItem({ name: "Conferir aterramento", statusClass: "rejected-state", statusText: "Rejeitado" }) +
    checklistItem({
      name: "Foto do painel",
      statusClass: "pending-state",
      statusText: "Pendente",
      attachment: { src: "https://files/1.png", name: "painel.png", statusClass: "accepted-state", statusText: "Aceito" },
    }) +
    `</div></div>` +
    `</app-checklist-execution-special>` +
    `</body></html>`
  );
}

function formStepsPage() {
  const step = (index, name, active, content) =>
    `<mat-step-header class="${active ? "mat-step-label-active" : ""}" role="tab" aria-selected="${active}">` +
    `<div class="mat-step-text-label">${name}</div></mat-step-header>` +
    (active ? content : "");

  const field = (label, value, extra) =>
    `<mat-form-field>${label ? `<mat-label>${label}</mat-label>` : ""}` +
    `<input class="mat-input-element" ${extra || ""} value="${value == null ? "" : value}" /></mat-form-field>`;

  const content1 =
    `<div class="mat-step-content">` +
    field("SMP ID", "123", "required") +
    field("Comentário", "") +
    `<mat-select aria-required="true"><div class="mat-select-value-text"></div>` +
    `<div class="mat-select-placeholder">Escolha</div></mat-select>` +
    `</div>`;

  const content2 =
    `<div class="mat-step-content">` +
    `<mat-radio-group><input type="radio" value="A" checked /><mat-radio-button class="mat-radio-checked">A</mat-radio-button>` +
    `<mat-radio-button>B</mat-radio-button></mat-radio-group>` +
    `<mat-checkbox class="mat-checkbox-checked"><input type="checkbox" checked /></mat-checkbox>` +
    `</div>`;

  return (
    `<!doctype html><html><head><title>Form</title></head><body>` +
    `<mat-stepper-horizontal>` +
    step(0, "1 Dados", true, content1) +
    step(1, "2 Revisão", false, "") +
    step(2, "3 Fotos", false, "") +
    `</mat-stepper-horizontal>` +
    `</body></html>`
  );
}

module.exports = { checklistPage, formStepsPage, checklistItem };
