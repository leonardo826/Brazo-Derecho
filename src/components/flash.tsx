import { ERRORS, OKS } from "@/lib/notices";

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  const errorText = error ? (ERRORS[error] ?? "No pudimos completar la acción.") : null;
  const okText = ok ? (OKS[ok] ?? null) : null;
  if (!errorText && !okText) return null;
  return (
    <div>
      {errorText ? (
        <p className="banner error" role="alert">
          {errorText}
        </p>
      ) : null}
      {okText ? (
        <p className="banner ok" role="status">
          {okText}
        </p>
      ) : null}
    </div>
  );
}
