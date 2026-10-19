// Form domain: reads form fields from a rendered step/tab scope.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../shared/text.js"),
      require("../shared/constants.js"),
      require("./dom.js")
    );
    return;
  }
  const ndpd = root.NdPd || (root.NdPd = {});
  ndpd.analyzer = ndpd.analyzer || {};
  ndpd.analyzer.form = factory(ndpd.shared.text, ndpd.shared.constants, ndpd.analyzer.dom);
})(typeof globalThis === "object" ? globalThis : this, function (text, constants, dom) {
  "use strict";

  const { clean, cleanLabel } = text;
  const { FIELD_TYPE_LABEL } = constants;
  const { isHidden } = dom;

  function fieldScope(el) {
    return (
      el.closest(
        "mat-form-field, mat-checkbox, mat-slide-toggle, app-input-box, app-select-box, app-radio, app-check-box, app-chip, .input-field-parent, .form-field, .radio, .checkbox"
      ) ||
      el.parentElement ||
      el
    );
  }

  function nearbyHeading(el) {
    let node = fieldScope(el);
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      let sibling = node.previousElementSibling;
      for (let hop = 0; sibling && hop < 4; hop += 1, sibling = sibling.previousElementSibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) {
          const text = cleanLabel(sibling.textContent);
          if (text) return text;
        }
        if (sibling.querySelector) {
          const heading = sibling.querySelector("h1, h2, h3, h4");
          if (heading) {
            const text = cleanLabel(heading.textContent);
            if (text) return text;
          }
        }
      }
    }
    return "";
  }

  function fieldLabel(el, type) {
    const scope = fieldScope(el);
    const labelEl = scope.querySelector(
      "mat-label, .input-label, .radio-label, .checkbox__lable, label:not(.mat-radio-label):not(.mat-checkbox-layout)"
    );
    if (labelEl) {
      const text = cleanLabel(labelEl.textContent);
      if (text) return text;
    }
    const attr = clean(el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "");
    if (attr) return attr;
    const aria = clean(el.getAttribute("aria-label") || "");
    if (aria) return aria;
    const heading = nearbyHeading(el);
    if (heading) return heading;
    const valueText = type === "radio" || type === "select" ? clean(el.textContent).slice(0, 60) : "";
    return valueText ? valueText + " (sem rótulo)" : "(sem rótulo)";
  }

  function isRequired(el) {
    if (el.required || el.getAttribute("aria-required") === "true" || el.hasAttribute("required")) return true;
    const scope = fieldScope(el);
    if (!scope) return false;
    if (/\*Required/i.test(clean(scope.textContent))) return true;
    if (scope.querySelector(".required, .required-span, [required]")) return true;
    return false;
  }

  function readTextFields(scope, fields) {
    for (const el of scope.querySelectorAll(
      "input.mat-input-element, input[matinput], textarea.mat-input-element, textarea[matinput]"
    )) {
      if (el.type === "radio" || el.type === "checkbox" || el.type === "hidden") continue;
      if (isHidden(el)) continue;
      const value = clean(el.value);
      fields.push({
        type: el.tagName === "TEXTAREA" ? "textarea" : el.type === "date" ? "date" : "text",
        typeLabel: el.tagName === "TEXTAREA" ? FIELD_TYPE_LABEL.textarea : FIELD_TYPE_LABEL.text,
        label: fieldLabel(el, "text"),
        value,
        filled: Boolean(value),
        required: isRequired(el),
        disabled: Boolean(el.disabled),
        readonly: Boolean(el.readOnly),
      });
    }
  }

  function readSelectFields(scope, fields) {
    for (const el of scope.querySelectorAll("mat-select")) {
      if (isHidden(el)) continue;
      const valueEl = el.querySelector(".mat-select-value-text, .mat-select-min-line");
      const value = clean(valueEl ? valueEl.textContent : "");
      const placeholder = clean((el.querySelector(".mat-select-placeholder") || {}).textContent || "");
      const filled = Boolean(value) && value !== placeholder;
      fields.push({
        type: "select",
        typeLabel: FIELD_TYPE_LABEL.select,
        label: fieldLabel(el, "select"),
        value: filled ? value : "",
        filled,
        required: isRequired(el),
        disabled: el.getAttribute("aria-disabled") === "true",
        readonly: false,
      });
    }
  }

  function readRadioFields(scope, fields) {
    for (const group of scope.querySelectorAll("mat-radio-group")) {
      if (isHidden(group)) continue;
      const inputs = Array.from(group.querySelectorAll("input[type=radio]"));
      const checkedButton = group.querySelector("mat-radio-button.mat-radio-checked");
      const checkedInput = checkedButton
        ? checkedButton.querySelector("input[type=radio]")
        : group.querySelector("input[type=radio]:checked");
      fields.push({
        type: "radio",
        typeLabel: FIELD_TYPE_LABEL.radio,
        label: fieldLabel(group, "radio"),
        value: checkedInput ? checkedInput.value : "",
        filled: Boolean(checkedInput),
        options: Array.from(group.querySelectorAll("mat-radio-button")).map((b) => clean(b.textContent)),
        required: isRequired(group),
        disabled: inputs.length > 0 && inputs.every((input) => input.disabled),
        readonly: false,
      });
    }
  }

  function readCheckboxFields(scope, fields) {
    for (const el of scope.querySelectorAll("app-check-box, mat-checkbox")) {
      if (isHidden(el)) continue;
      const input = el.querySelector("input[type=checkbox]");
      const checked = el.classList.contains("mat-checkbox-checked") || (input && input.checked);
      fields.push({
        type: "checkbox",
        typeLabel: FIELD_TYPE_LABEL.checkbox,
        label: fieldLabel(el, "checkbox"),
        value: checked ? "Sim" : "Não",
        filled: true,
        required: isRequired(el),
        disabled: el.classList.contains("mat-checkbox-disabled") || (input && input.disabled),
        readonly: false,
      });
    }
  }

  function readToggleFields(scope, fields) {
    for (const el of scope.querySelectorAll("mat-slide-toggle")) {
      if (isHidden(el)) continue;
      const checked = el.classList.contains("mat-checked");
      fields.push({
        type: "toggle",
        typeLabel: FIELD_TYPE_LABEL.toggle,
        label: fieldLabel(el, "toggle"),
        value: checked ? "Ligado" : "Desligado",
        filled: true,
        required: isRequired(el),
        disabled: el.classList.contains("mat-disabled"),
        readonly: false,
      });
    }
  }

  function readFields(scope) {
    if (!scope) return [];
    const fields = [];
    readTextFields(scope, fields);
    readSelectFields(scope, fields);
    readRadioFields(scope, fields);
    readCheckboxFields(scope, fields);
    readToggleFields(scope, fields);
    return fields;
  }

  return { fieldScope, nearbyHeading, fieldLabel, isRequired, readFields };
});
