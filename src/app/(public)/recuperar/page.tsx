import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { firstParam } from "@/lib/search";

export const metadata: Metadata = { title: "Recuperar contraseña" };
export const dynamic = "force-dynamic";

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <section className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Cuenta</p>
        <h1>¿Olvidaste tu contraseña?</h1>
        <p className="muted">
          Escribe el correo de tu cuenta. Si existe, te enviamos un enlace para elegir una contraseña nueva. El enlace
          dura una hora y se usa una sola vez.
        </p>
        <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
        <form action={requestPasswordResetAction} className="stack">
          <CsrfField />
          <label>
            Correo
            <input name="email" type="email" autoComplete="email" required placeholder="maria@losaromos.cl" />
          </label>
          <button className="button" type="submit">
            Enviar enlace
          </button>
        </form>
        <p className="muted">
          <Link href="/ingresar">Volver a ingresar</Link>
        </p>
      </div>
    </section>
  );
}
