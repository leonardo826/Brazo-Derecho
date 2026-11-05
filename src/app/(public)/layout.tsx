import { headers } from "next/headers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/") return children;
  return (
    <>
      <SiteHeader />
      <main id="contenido">{children}</main>
      <SiteFooter />
    </>
  );
}
