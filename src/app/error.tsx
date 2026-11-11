"use client";

import { useEffect } from "react";
import { CLIENT_FAILURE_BODY, CLIENT_FAILURE_TITLE, clientErrorBody } from "@/lib/client-error";

function reportClientError(error: Error) {
  const body = JSON.stringify(clientErrorBody(error.name || "Error", error.message || "error"));
  void fetch("/api/observabilidad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <main className="auth-screen">
      <div className="narrow card stack">
        <p className="eyebrow">Error</p>
        <h1>{CLIENT_FAILURE_TITLE}</h1>
        <p>{CLIENT_FAILURE_BODY}</p>
        <button className="button" type="button" onClick={() => reset()}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
