import { resendVerificationAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";

export function VerifyBanner() {
  return (
    <div className="banner warn" role="status">
      <p>
        Tu correo todavía no está confirmado. Puedes seguir usando el panel. Te enviamos un enlace; si el correo está
        en modo simulado, el mensaje queda en Administración para que lo abras en la demo.
      </p>
      <form action={resendVerificationAction}>
        <CsrfField />
        <button className="button small" type="submit">
          Reenviar enlace
        </button>
      </form>
    </div>
  );
}
