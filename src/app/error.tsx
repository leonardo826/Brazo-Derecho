"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Error</p>
        <h1>Algo falló</h1>
        <p>No pudimos completar la acción. Si acabas de instalar la beta, revisa que Postgres esté corriendo.</p>
        <button className="button" type="button" onClick={() => reset()}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
