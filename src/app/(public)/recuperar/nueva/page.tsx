import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { firstParam } from "@/lib/search";

export const metadata: Metadata = { title: "Nueva contraseña" };
export const dynamic = "force-dynamic";

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = firstParam(params.token) ?? "";
  return (
    <section className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Cuenta</p>
        <h1>Elige una contraseña nueva</h1>
        <p className="muted">El enlace dura una hora y se puede usar una sola vez. Después ingresas con la contraseña nueva.</p>
        <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
        {token ? (
          <form action={resetPasswordAction} className="stack">
            <CsrfField />
            <input type="hidden" name="token" value={token} />
            <label>
              Contraseña nueva
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres, con una letra y un número"
              />
            </label>
            <button className="button" type="submit">
              Guardar contraseña
            </button>
          </form>
        ) : (
          <p>
            Falta el enlace. <Link href="/recuperar">Pide uno nuevo</Link>.
          </p>
        )}
        <p className="muted">
          <Link href="/ingresar">Volver a ingresar</Link>
        </p>
      </div>
    </section>
  );
}
