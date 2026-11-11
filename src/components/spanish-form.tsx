"use client";

import { type ComponentProps, type FormEvent } from "react";
import { spanishFieldMessage } from "@/lib/spanish-validity";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(node: Element): node is Field {
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
}

function messageFor(field: Field) {
  const minLength = "minLength" in field && field.minLength > 0 ? field.minLength : undefined;
  const maxLength = "maxLength" in field && field.maxLength > 0 && field.maxLength < 500_000 ? field.maxLength : undefined;
  return spanishFieldMessage({
    valueMissing: field.validity.valueMissing,
    typeMismatch: field.validity.typeMismatch,
    tooShort: field.validity.tooShort,
    tooLong: field.validity.tooLong,
    type: field instanceof HTMLInputElement ? field.type : undefined,
    minLength,
    maxLength,
  });
}

function clearErrors(form: HTMLFormElement) {
  form.querySelectorAll("[data-field-error]").forEach((node) => node.remove());
  form.querySelectorAll("input, textarea, select").forEach((node) => {
    if (!isField(node)) return;
    node.removeAttribute("aria-invalid");
    const described = node.getAttribute("aria-describedby");
    if (!described) return;
    const rest = described
      .split(/\s+/)
      .filter((id) => !id.endsWith("-error"))
      .join(" ");
    if (rest) node.setAttribute("aria-describedby", rest);
    else node.removeAttribute("aria-describedby");
  });
}

function showError(field: Field, text: string) {
  const id = field.id || `campo-${field.getAttribute("name") || "dato"}`;
  field.id = id;
  const errorId = `${id}-error`;
  const note = document.createElement("p");
  note.id = errorId;
  note.className = "field-error";
  note.dataset.fieldError = "";
  note.setAttribute("role", "alert");
  note.setAttribute("aria-label", text);
  note.textContent = text;
  const described = field.getAttribute("aria-describedby");
  field.setAttribute("aria-describedby", described ? `${described} ${errorId}` : errorId);
  field.setAttribute("aria-invalid", "true");
  const anchor = field.closest("label") ?? field;
  anchor.insertAdjacentElement("afterend", note);
}

export function SpanishForm(props: ComponentProps<"form">) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    clearErrors(form);
    const invalid = [...form.querySelectorAll("input, textarea, select")].filter((node): node is Field => {
      if (!isField(node)) return false;
      if (node instanceof HTMLInputElement && (node.type === "hidden" || node.type === "submit")) return false;
      if (node.disabled) return false;
      return !node.checkValidity();
    });
    if (invalid.length === 0) return;
    event.preventDefault();
    for (const field of invalid) showError(field, messageFor(field));
    invalid[0]?.focus();
  }
  return <form {...props} noValidate onSubmit={onSubmit} />;
}
