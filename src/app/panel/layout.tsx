import { PanelShell } from "@/components/panel-shell";
import { isPlatformAdmin } from "@/lib/admin";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <PanelShell session={session} showAdmin={isPlatformAdmin(session.email)}>{children}</PanelShell>;
}
