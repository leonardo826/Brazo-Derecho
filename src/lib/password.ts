import bcrypt from "bcryptjs";

export function passwordError(password: string) {
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password)) return "La contraseña debe incluir una letra.";
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir un número.";
  return null;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
