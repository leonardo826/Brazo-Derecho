export const MACHINE_AGENT_KINDS = ["ACCOUNTING", "MARKETING", "WHATSAPP"] as const;

export type MachineAgentKind = (typeof MACHINE_AGENT_KINDS)[number];

export function machineAgentKind(value: string): MachineAgentKind | null {
  return (MACHINE_AGENT_KINDS as readonly string[]).includes(value) ? (value as MachineAgentKind) : null;
}
