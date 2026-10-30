import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { firstParam } from "@/lib/search";
import { resolveSession } from "@/lib/session";
import { safePanelPath } from "@/lib/paths";

export const metadata: Metadata = { title: "Ingresar" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolveSession();
  if (session) redirect("/panel");
  const params = await searchParams;
  const siguiente = safePanelPath(firstParam(params.siguiente));
  return (
    <section className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Cuenta</p>
        <h1>Ingresar</h1>
        <Flash error={firstParam(params.error)} />
        <form action={loginAction} className="stack">
          <CsrfField />
          <input type="hidden" name="siguiente" value={siguiente} />
          <label>
            Correo
            <input name="email" type="email" autoComplete="email" required placeholder="maria@losaromos.cl" />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="button" type="submit">
            Entrar al panel
          </button>
        </form>
        <p className="muted">
          ¿Todavía no tienes empresa? <Link href="/registro">Crear cuenta</Link>
        </p>
      </div>
    </section>
  );
}
