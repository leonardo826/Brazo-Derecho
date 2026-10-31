import { generatePostsAction, saveBrandAction } from "@/app/actions/marketing";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { limitFor, modelFor } from "@/lib/catalog";
import { formatWhen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [{ subscription, open }, profile, posts, usage] = await Promise.all([
    agentIsOpen(session.organizationId, "MARKETING"),
    prisma.brandProfile.findUnique({ where: { organizationId: session.organizationId } }),
    prisma.marketingPost.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    usageSnapshot(session.organizationId),
  ]);
  const textLimit = limitFor("MARKETING", "TEXTS");
  const imageLimit = limitFor("MARKETING", "IMAGES");

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{modelFor("MARKETING")}</p>
          <h1>Marketing</h1>
          <p className="muted">Los textos quedan en borrador. Brazo Derecho no publica ni compra avisos.</p>
        </div>
        <SubscribeActions agent="MARKETING" back="/panel/marketing" subscription={subscription} />
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {firstParam(params.guia) === "1" ? (
        <p className="banner ok">
          La prueba de 14 días quedó activa. No se cobró nada. Guarda la voz de tu marca y prepara un borrador. No se publica solo.
        </p>
      ) : null}
      <div className="grid-2">
        <UsageBar used={usage.totals.TEXTS} limit={textLimit} label="Textos de este mes" />
        <UsageBar used={usage.totals.IMAGES} limit={imageLimit} label="Imágenes de este mes" />
      </div>
      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="panel-card stack">
          <h2>Perfil de marca</h2>
          <form action={saveBrandAction} className="stack">
            <CsrfField />
            <label>
              Voz
              <input name="voice" required maxLength={200} defaultValue={profile?.voice ?? ""} placeholder="Cercana, clara, sin tecnicismos" />
            </label>
            <label>
              Público
              <input name="audience" required maxLength={200} defaultValue={profile?.audience ?? ""} placeholder="Dueños de casa y maestros en Santiago" />
            </label>
            <label>
              Resumen del negocio
              <textarea name="summary" required maxLength={600} defaultValue={profile?.summary ?? ""} placeholder="Ferretería de barrio con despacho dentro de Santiago." />
            </label>
            <button className="button" type="submit">
              Guardar perfil
            </button>
          </form>
          {open && profile ? (
            <form action={generatePostsAction} className="stack">
              <CsrfField />
              <label>
                Cuántos borradores
                <input name="count" type="number" min={1} max={8} defaultValue={4} />
              </label>
              <label className="check">
                <input type="checkbox" name="withImage" defaultChecked />
                Incluir imagen borrador (cuenta para el límite de imágenes)
              </label>
              <button className="button" type="submit" disabled={usage.totals.TEXTS >= textLimit}>
                Preparar borradores
              </button>
              <p className="muted">
                Si se acaban las imágenes ({usage.totals.IMAGES.toLocaleString("es-CL")} de {imageLimit.toLocaleString("es-CL")}), desmarca la casilla para seguir solo con textos.
              </p>
            </form>
          ) : (
            <EmptyState title="Falta el perfil o la prueba">
              {!profile
                ? "Cuéntanos la voz, el público y un resumen. El agente no inventa promociones que no estén ahí."
                : "Activa la prueba de 14 días para preparar el primer borrador. Nada se publica solo."}
            </EmptyState>
          )}
        </section>
        <section className="stack">
          {posts.length === 0 ? (
            <EmptyState title="Todavía no hay borradores">
              Cuando prepares uno, queda en esta lista para que lo revises. Brazo Derecho no lo publica ni compra avisos.
            </EmptyState>
          ) : null}
          {posts.map((post) => (
            <article className="panel-card draft" key={post.id}>
              <div className="draft-grid">
                {post.imageSvg ? (
                  // SVG generado en el servidor. No es un archivo estático para next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`Borrador visual para ${post.channel}. No está publicado.`}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(post.imageSvg)}`}
                  />
                ) : (
                  <p className="muted">Sin imagen</p>
                )}
                <div>
                  <p className="badge">{post.status === "DRAFT" ? "Borrador" : post.status}</p>
                  <h2>{post.title}</h2>
                  <p className="muted">{formatWhen(post.createdAt)}</p>
                  <pre className="copy">{post.copy}</pre>
                  {post.imagePrompt ? <p className="muted">Idea de imagen: {post.imagePrompt}</p> : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
