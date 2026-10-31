export function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string) {
  return adminEmails().includes(email.trim().toLowerCase());
}
