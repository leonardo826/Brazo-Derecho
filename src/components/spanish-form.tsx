"use client";

import { type ComponentProps, type FormEvent } from "react";
import { spanishFieldMessage } from "@/lib/spanish-validity";

function messageFor(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
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

export function SpanishForm(props: ComponentProps<"form">) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
    for (const field of fields) field.setCustomValidity("");
    for (const field of fields) {
      if (!field.validity.valid) field.setCustomValidity(messageFor(field));
    }
    if (!form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
    }
  }
  return <form {...props} onSubmit={onSubmit} />;
}
