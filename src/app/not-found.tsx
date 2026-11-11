import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">404</p>
        <h1>No está esta página</h1>
        <p>Esta página no existe.</p>
        <Link className="button-link" href="/panel">
          Ir al panel
        </Link>
      </div>
    </main>
  );
}
