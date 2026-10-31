import type { Metadata } from "next";
import Link from "next/link";
import { confirmEmailAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { firstParam } from "@/lib/search";
import { resolveSession } from "@/lib/session";

export const metadata: Metadata = { title: "Confirmar correo" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = firstParam(params.token) ?? "";
  const session = await resolveSession();
  const confirmed = firstParam(params.ok) === "correo_ok";
  return (
    <section className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Cuenta</p>
        <h1>Confirmar correo</h1>
        <p className="muted">
          Este enlace dura 48 horas y se usa una sola vez. Confirmar no es obligatorio para usar el panel.
        </p>
        <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
        {token && !confirmed ? (
          <form action={confirmEmailAction} className="stack">
            <CsrfField />
            <input type="hidden" name="token" value={token} />
            <button className="button" type="submit">
              Confirmar mi correo
            </button>
          </form>
        ) : null}
        {!token && !confirmed ? (
          <p>
            Falta el enlace. Si ya tienes sesión, puedes pedir otro desde el aviso del panel.
          </p>
        ) : null}
        <p className="muted">
          {session ? <Link href="/panel">Volver al panel</Link> : <Link href="/ingresar">Ingresar</Link>}
        </p>
      </div>
    </section>
  );
}
