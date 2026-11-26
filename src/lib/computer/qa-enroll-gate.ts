const NAMES = ["QA_ENROLL_SPEC", "QA_ENROLL_TOKEN_A", "QA_ENROLL_TOKEN_B", "QA_ENROLL_TOKEN_C"] as const;

export type QaEnrollMode = "skip" | "partial" | "run";

type GateEnv = {
  QA_ENROLL_SPEC?: string;
  QA_ENROLL_TOKEN_A?: string;
  QA_ENROLL_TOKEN_B?: string;
  QA_ENROLL_TOKEN_C?: string;
  [key: string]: string | undefined;
};

export function qaEnrollConfigured(env: GateEnv): QaEnrollMode {
  const present = NAMES.map((name) => Boolean(env[name]?.trim()));
  if (present.every((item) => !item)) return "skip";
  if (present.every(Boolean)) return "run";
  return "partial";
}

const SAFE_ID = /^[A-Za-z0-9_-]{4,80}$/;

/** Solo orgId y OK o ERROR. Un id raro no se copia: podría ser un secreto pegado en el campo equivocado. */
export function qaEnrollLogLine(orgId: string, ok: boolean) {
  const id = SAFE_ID.test(orgId) ? orgId : "-";
  return `qa-enroll orgId=${id} ${ok ? "OK" : "ERROR"}`;
}
