export type FieldValidity = {
  valueMissing: boolean;
  typeMismatch: boolean;
  tooShort: boolean;
  tooLong: boolean;
  type?: string;
  minLength?: number;
  maxLength?: number;
};

export function spanishFieldMessage(field: FieldValidity) {
  if (field.valueMissing) {
    return field.type === "checkbox" ? "Marca esta casilla para continuar." : "Completa este campo.";
  }
  if (field.typeMismatch) return "Escribe un correo válido.";
  if (field.tooShort) return `Usa al menos ${field.minLength ?? 8} caracteres.`;
  if (field.tooLong) return `Usa como máximo ${field.maxLength ?? 0} caracteres.`;
  return "Revisa este campo.";
}
