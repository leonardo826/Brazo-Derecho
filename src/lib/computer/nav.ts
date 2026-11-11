import { computerPanelEnabled } from "@/lib/computer/flag";

type FlagEnv = {
  COMPUTER_FEATURE_ENABLED?: string;
  COMPUTER_PANEL?: string;
  NODE_ENV?: string;
};

export function panelComputerHref(env: FlagEnv = process.env) {
  return computerPanelEnabled(env) ? "/panel/computador" : null;
}
