import { ERRORS, OKS } from "@/lib/notices";

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  const errorText = error ? (ERRORS[error] ?? "No pudimos completar la acción.") : null;
  const okText = ok ? (OKS[ok] ?? null) : null;
  if (!errorText && !okText) return null;
  return (
    <div aria-live="polite">
      {errorText ? <p className="banner error">{errorText}</p> : null}
      {okText ? <p className="banner ok">{okText}</p> : null}
    </div>
  );
}
