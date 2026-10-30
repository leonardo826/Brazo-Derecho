import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">404</p>
        <h1>No está esta página</h1>
        <p>El enlace no existe o la cotización no es de tu empresa.</p>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
