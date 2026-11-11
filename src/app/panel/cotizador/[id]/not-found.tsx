import Link from "next/link";

export default function QuoteNotFound() {
  return (
    <main className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">404</p>
        <h1>No está esta página</h1>
        <p>El enlace no existe o la cotización no es de tu empresa.</p>
        <Link className="button-link" href="/panel/cotizador">
          Volver al cotizador
        </Link>
      </div>
    </main>
  );
}
