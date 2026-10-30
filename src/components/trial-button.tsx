import { activateTrialAction } from "@/app/actions/subscriptions";

export function TrialButton({
  agent,
  back,
  label = "Activar prueba de 14 días",
}: {
  agent: string;
  back: string;
  label?: string;
}) {
  return (
    <form action={activateTrialAction}>
      <input type="hidden" name="agent" value={agent} />
      <input type="hidden" name="back" value={back} />
      <button className="button" type="submit">
        {label}
      </button>
    </form>
  );
}
