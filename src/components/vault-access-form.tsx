import { createCredentialAction } from "@/app/actions/boveda";
import { CsrfField } from "@/components/csrf-field";
import type { PortalPreset } from "@/lib/credentials/portal-form";

export function VaultAccessForm({ preset }: { preset: PortalPreset | null }) {
  const usernameLabel = preset?.usernameLabel ?? "Usuario";
  const rutField = usernameLabel.includes("RUT");
  return (
    <form action={createCredentialAction} className="panel-card stack" id="agregar-acceso">
      <CsrfField />
      <input type="hidden" name="portalPreset" value={preset?.id ?? ""} />
      <h2>Agregar acceso</h2>
      {preset ? (
        <p className="muted">
          Formulario de {preset.portal}.{rutField ? ` El RUT va en ${usernameLabel}.` : ""} La clave no se escribe en el chat.
          Guardar no entra al portal.
        </p>
      ) : (
        <p className="muted">El RUT, si el portal lo usa, va en Usuario. La clave no se escribe en el chat. Guardar no entra al portal.</p>
      )}
      <label>
        Nombre
        <input
          name="label"
          required
          minLength={2}
          maxLength={80}
          placeholder="Clave SII"
          autoComplete="off"
          defaultValue={preset?.label ?? ""}
        />
      </label>
      <label>
        Portal o sitio
        <input
          name="portal"
          required
          minLength={2}
          maxLength={120}
          placeholder="SII"
          autoComplete="off"
          defaultValue={preset?.portal ?? ""}
        />
      </label>
      <label>
        {usernameLabel}
        <input
          name="username"
          required
          maxLength={160}
          autoComplete="off"
          placeholder={preset?.usernamePlaceholder || "12.345.678-9"}
        />
      </label>
      <label>
        Clave
        <input name="secret" type="password" required minLength={4} maxLength={400} autoComplete="new-password" />
      </label>
      <p className="muted">Después de guardar, la clave no se vuelve a mostrar. No queda en el chat ni se manda al modelo.</p>
      <label className="check">
        <input name="consent" type="checkbox" required />
        <span>Acepto guardar esta clave en la bóveda de mi empresa, con el cifrado y los límites de arriba.</span>
      </label>
      <button className="button" type="submit">
        Guardar en la bóveda
      </button>
    </form>
  );
}
