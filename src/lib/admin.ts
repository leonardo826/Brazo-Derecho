type AdminEnv = { ADMIN_EMAILS?: string };

function adminSource(env?: AdminEnv) {
  return env ? (env.ADMIN_EMAILS ?? "") : (process.env.ADMIN_EMAILS ?? "");
}

export function adminEmails(env?: AdminEnv) {
  return adminSource(env)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string, env?: AdminEnv) {
  return adminEmails(env).includes(email.trim().toLowerCase());
}

export function roleMayManageMachine(role: "OWNER" | "STAFF" | null, email: string, env?: AdminEnv) {
  if (email && isPlatformAdmin(email, env)) return true;
  return role === "OWNER";
}
