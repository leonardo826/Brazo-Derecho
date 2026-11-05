import { isQaLogin, provisionQaAccount } from "@/lib/qa-account";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/session-token";

/**
 * Login de QA o el de siempre. No escribe la sesión: eso lo hace la acción,
 * después de validar el formulario. No registra la clave ni el hash.
 */
export async function authenticate(email: string, password: string): Promise<Session | null> {
  const normalized = email.trim().toLowerCase();
  if (isQaLogin(normalized, password)) {
    const account = await provisionQaAccount(normalized, password);
    return {
      userId: account.user.id,
      email: account.user.email,
      name: account.user.name,
      organizationId: account.organization.id,
      organizationName: account.organization.name,
      role: "OWNER",
      authVersion: account.user.authVersion,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: {
      memberships: {
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) return null;
  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
    authVersion: user.authVersion,
  };
}
