import type { DesktopAction } from "./actions.ts";
import type { CredentialMeta } from "./credentials.ts";

export type DesktopStatus = {
  ok: boolean;
  display: string;
  chromium: "up" | "down";
  whatsappTab: boolean;
  profileDir: string;
};

export interface Desktop {
  screenshot(): Promise<Buffer>;
  perform(action: DesktopAction): Promise<void>;
  status(): Promise<DesktopStatus>;
}

export type ModelDecision = { kind: "act"; action: DesktopAction } | { kind: "done"; result: string };

export type DecideInput = {
  goal: string;
  screenshot: Buffer;
  step: number;
  history: string[];
  credentials?: CredentialMeta[];
  clientConfirmed?: boolean;
};

export interface ComputerModel {
  decide(input: DecideInput): Promise<ModelDecision>;
}

export function pickWorkWindow(windows: { id: string; name: string }[]) {
  const work = windows.find((window) => window.name && !/whatsapp/i.test(window.name));
  return (work ?? windows[0])?.id ?? null;
}
