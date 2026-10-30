import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { firstParam } from "@/lib/search";
import { resolveSession } from "@/lib/session";

export const metadata: Metadata = { title: "Crear cuenta" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolveSession();
  if (session) redirect("/panel");
  const params = await searchParams;
  return (
    <section className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Nueva empresa</p>
        <h1>Crear cuenta</h1>
        <p className="muted">Una cuenta, una empresa. Después eliges un agente y lo pruebas 14 días, sin tarjeta.</p>
        <Flash error={firstParam(params.error)} />
        <form action={registerAction} className="stack">
          <CsrfField />
          <label>
            Tu nombre
            <input name="name" required minLength={2} maxLength={80} autoComplete="name" placeholder="María Soto" />
          </label>
          <label>
            Correo
            <input name="email" type="email" required autoComplete="email" placeholder="maria@tuempresa.cl" />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres, con una letra y un número"
            />
          </label>
          <label>
            Nombre del negocio
            <input name="organizationName" required minLength={2} maxLength={120} placeholder="Ferretería Los Aromos" />
          </label>
          <label>
            RUT de la empresa (opcional)
            <input name="rut" maxLength={20} placeholder="76.123.456-0" />
          </label>
          <label className="check">
            <input name="consent" type="checkbox" required />
            <span>
              Acepto los <Link href="/terminos">Términos del Servicio</Link> y he leído el{" "}
              <Link href="/privacidad">Aviso de Privacidad</Link>.
            </span>
          </label>
          <label className="check">
            <input name="marketingOptIn" type="checkbox" />
            <span>Quiero recibir novedades y ofertas de Brazo Derecho.</span>
          </label>
          <button className="button" type="submit">
            Crear empresa
          </button>
        </form>
        <p className="muted">
          ¿Ya tienes cuenta? <Link href="/ingresar">Ingresar</Link>
        </p>
      </div>
    </section>
  );
}
