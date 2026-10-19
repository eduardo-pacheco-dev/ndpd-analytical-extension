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

  // Text-like controls. It intentionally covers both Angular Material controls
  // (`.mat-input-element`/`matinput`) and the NDPd wrappers (`app-input-box`, `mat-form-field`,
  // `.input-field`), so a field is not missed just because a class is missing.
  const TEXT_FIELD_SELECTOR = [
    "input.mat-input-element",
    "input[matInput]",
    "textarea.mat-input-element",
    "textarea[matInput]",
    "mat-form-field input",
    "mat-form-field textarea",
    "app-input-box input",
    "app-input-box textarea",
    "input.input-field",
    "input.form-control",
    "textarea.text-area",
  ].join(",");

  const EXCLUDED_INPUT_TYPES = new Set([
    "radio",
    "checkbox",
    "hidden",
    "button",
    "submit",
    "reset",
    "image",
    "file",
    "range",
  ]);

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

  function isFieldElement(el) {
    if (!el) return false;
    if (el.tagName === "INPUT" && EXCLUDED_INPUT_TYPES.has(String(el.type || "").toLowerCase())) return false;
    if (el.classList && el.classList.contains("text-area-for-image-name")) return false;
    return true;
  }

  function selectedOptionText(select) {
    const option = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    return clean(option ? option.textContent : select.value);
  }

  function buildTextField(el) {
    const value = clean(el.value);
    const isTextarea = el.tagName === "TEXTAREA";
    return {
      type: isTextarea ? "textarea" : el.type === "date" ? "date" : "text",
      typeLabel: isTextarea ? FIELD_TYPE_LABEL.textarea : FIELD_TYPE_LABEL.text,
      label: fieldLabel(el, "text"),
      value,
      filled: Boolean(value),
      required: isRequired(el),
      disabled: Boolean(el.disabled),
      readonly: Boolean(el.readOnly),
    };
  }

  function buildNativeSelectField(el) {
    const value = selectedOptionText(el);
    return {
      type: "select",
      typeLabel: FIELD_TYPE_LABEL.select,
      label: fieldLabel(el, "select"),
      value,
      filled: Boolean(value),
      options: Array.from(el.options).map((option) => clean(option.textContent)),
      required: isRequired(el),
      disabled: Boolean(el.disabled),
      readonly: false,
    };
  }

  function buildSelectField(el) {
    const valueEl = el.querySelector(".mat-select-value-text, .mat-select-min-line");
    const value = clean(valueEl ? valueEl.textContent : "");
    const placeholder = clean((el.querySelector(".mat-select-placeholder") || {}).textContent || "");
    const filled = Boolean(value) && value !== placeholder;
    return {
      type: "select",
      typeLabel: FIELD_TYPE_LABEL.select,
      label: fieldLabel(el, "select"),
      value: filled ? value : "",
      filled,
      required: isRequired(el),
      disabled: el.getAttribute("aria-disabled") === "true",
      readonly: false,
    };
  }

  function buildRadioField(group) {
    const inputs = Array.from(group.querySelectorAll("input[type=radio]"));
    const checkedButton = group.querySelector("mat-radio-button.mat-radio-checked");
    const checkedInput = checkedButton
      ? checkedButton.querySelector("input[type=radio]")
      : group.querySelector("input[type=radio]:checked");
    return {
      type: "radio",
      typeLabel: FIELD_TYPE_LABEL.radio,
      label: fieldLabel(group, "radio"),
      value: checkedInput ? checkedInput.value : "",
      filled: Boolean(checkedInput),
      options: Array.from(group.querySelectorAll("mat-radio-button")).map((b) => clean(b.textContent)),
      required: isRequired(group),
      disabled: inputs.length > 0 && inputs.every((input) => input.disabled),
      readonly: false,
    };
  }

  function buildCheckboxField(el) {
    const input = el.querySelector("input[type=checkbox]");
    const checked = el.classList.contains("mat-checkbox-checked") || (input && input.checked);
    return {
      type: "checkbox",
      typeLabel: FIELD_TYPE_LABEL.checkbox,
      label: fieldLabel(el, "checkbox"),
      value: checked ? "Sim" : "Não",
      filled: true,
      required: isRequired(el),
      disabled: el.classList.contains("mat-checkbox-disabled") || (input && input.disabled),
      readonly: false,
    };
  }

  function buildToggleField(el) {
    const checked = el.classList.contains("mat-checked");
    return {
      type: "toggle",
      typeLabel: FIELD_TYPE_LABEL.toggle,
      label: fieldLabel(el, "toggle"),
      value: checked ? "Ligado" : "Desligado",
      filled: true,
      required: isRequired(el),
      disabled: el.classList.contains("mat-disabled"),
      readonly: false,
    };
  }

  function buildButtonToggleField(group) {
    const buttons = Array.from(group.querySelectorAll("mat-button-toggle, .mat-button-toggle"));
    const checked = group.querySelector(
      "mat-button-toggle.mat-button-toggle-checked, .mat-button-toggle-checked, [aria-pressed='true']"
    );
    return {
      type: "button-toggle",
      typeLabel: FIELD_TYPE_LABEL.buttonToggle,
      label: fieldLabel(group, "radio"),
      value: checked ? clean(checked.textContent) : "",
      filled: Boolean(checked),
      options: buttons.map((button) => clean(button.textContent)),
      required: isRequired(group),
      disabled: group.getAttribute("aria-disabled") === "true" || group.classList.contains("mat-button-toggle-group-disabled"),
      readonly: false,
    };
  }

  const BUILDERS = {
    text: buildTextField,
    "native-select": buildNativeSelectField,
    select: buildSelectField,
    radio: buildRadioField,
    checkbox: buildCheckboxField,
    toggle: buildToggleField,
    "button-toggle": buildButtonToggleField,
  };

  // Collects field elements once (document order, deduplicated across overlapping scopes).
  function collectFieldElements(scopes) {
    const seen = new Set();
    const elements = [];
    const add = (el, kind) => {
      if (!el || seen.has(el) || !isFieldElement(el) || isHidden(el)) return;
      seen.add(el);
      elements.push({ el, kind });
    };
    const addAll = (scope, selector, kind) => {
      if (!scope || typeof scope.querySelectorAll !== "function") return;
      for (const el of scope.querySelectorAll(selector)) add(el, kind);
    };

    for (const scope of scopes || []) {
      addAll(scope, TEXT_FIELD_SELECTOR, "text");
      addAll(scope, "select", "native-select");
      addAll(scope, "mat-select", "select");
      addAll(scope, "mat-radio-group", "radio");
      addAll(scope, "app-check-box, mat-checkbox", "checkbox");
      addAll(scope, "mat-slide-toggle", "toggle");
      addAll(scope, "mat-button-toggle-group", "button-toggle");
    }
    return elements;
  }

  function readFields(scope) {
    if (!scope) return [];
    return readFieldsFromScopes([scope]);
  }

  // Reads fields from several (possibly nested) scopes, without duplicating a field
  // that appears in more than one container.
  function readFieldsFromScopes(scopes) {
    return collectFieldElements(scopes).map(({ el, kind }) => BUILDERS[kind](el));
  }

  return {
    fieldScope,
    nearbyHeading,
    fieldLabel,
    isRequired,
    readFields,
    readFieldsFromScopes,
    collectFieldElements,
    TEXT_FIELD_SELECTOR,
  };
});
