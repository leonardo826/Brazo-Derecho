"use client";

import { useEffect } from "react";
import { clientErrorBody } from "@/lib/client-error";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const body = JSON.stringify(clientErrorBody(error.name || "Error", error.message || "error"));
    void fetch("/api/observabilidad", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="es-CL">
      <body>
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
      </body>
    </html>
  );
}
